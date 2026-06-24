-- ============================================================
-- Custodial escrow for XRP self-bets  (Gate 0C)
-- ============================================================
-- Before this migration an XRP self-bet kept the stake in the user's OWN wallet and
-- the device sent the forfeit fire-and-forget on a loss — a failed/dropped send left
-- an unpaid debt with no record or retry. Now an XRP stake is escrowed into the
-- omnibus treasury at create time (the same account that holds group stakes), so
-- settlement is server-authoritative and unavoidable:
--
--   • LOSS → the already-held funds simply stay in the treasury (the house).
--            No on-chain move; we just mark the escrow 'forfeited'.
--   • WIN  → the treasury refunds the stake on-chain to the user's wallet.
--
-- Token bets are unchanged (they were already escrowed in user_profiles). All escrow
-- amounts are integer DROPS (1 XRP = 1e6). Escrow state lives on the self_bets row;
-- writes happen only through the SECURITY DEFINER RPCs below (service_role only), the
-- same trust model as the treasury ledger RPCs.

-- ─── escrow columns on self_bets ─────────────────────────────────────────────
--   none      : token bet (or a legacy XRP bet predating escrow) — no held funds
--   pending   : XRP bet created, awaiting the on-chain deposit into the treasury
--   held      : deposit verified on-chain, funds held in the treasury
--   settling  : a WIN refund payout has been reserved (in-flight / awaiting confirm)
--   refunded  : WIN refund confirmed on-chain to the user
--   forfeited : LOSS — funds kept by the treasury (the house)
ALTER TABLE public.self_bets
  ADD COLUMN IF NOT EXISTS escrow_status   TEXT   NOT NULL DEFAULT 'none'
      CHECK (escrow_status IN ('none', 'pending', 'held', 'settling', 'refunded', 'forfeited')),
  ADD COLUMN IF NOT EXISTS escrow_drops    BIGINT NOT NULL DEFAULT 0 CHECK (escrow_drops >= 0),
  ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT,   -- verified on-chain deposit into treasury
  ADD COLUMN IF NOT EXISTS payout_tx_hash  TEXT;   -- signed on-chain refund out of treasury

-- ─── open_self_bet (redefined) ───────────────────────────────────────────────
-- Same as the original, but an XRP bet starts in escrow_status 'pending' so it is
-- not considered funded until the deposit is confirmed. Token logic is unchanged.
CREATE OR REPLACE FUNCTION public.open_self_bet(
  p_user_id      UUID,
  p_provider     TEXT,
  p_metric       TEXT,
  p_target       NUMERIC,
  p_period_end   TIMESTAMPTZ,
  p_baseline     NUMERIC,
  p_stake_amount NUMERIC,
  p_stake_type   TEXT,
  p_wallet       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet_id       UUID;
  v_rows_updated INTEGER;
BEGIN
  IF p_stake_amount IS NULL OR p_stake_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_stake');
  END IF;

  -- Token path: atomic check-and-deduct (single statement, no read-then-write race)
  IF p_stake_type = 'tokens' THEN
    UPDATE public.user_profiles
    SET    tokens = tokens - p_stake_amount
    WHERE  user_id = p_user_id AND tokens >= p_stake_amount;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_tokens');
    END IF;
  END IF;

  INSERT INTO public.self_bets (
    user_id, provider, metric, target_count, baseline,
    period_end, stake_amount, stake_type, wallet_address, escrow_status
  )
  VALUES (
    p_user_id, p_provider, p_metric, p_target, COALESCE(p_baseline, 0),
    p_period_end, p_stake_amount, p_stake_type, p_wallet,
    CASE WHEN p_stake_type = 'xrp' THEN 'pending' ELSE 'none' END
  )
  RETURNING id INTO v_bet_id;

  RETURN jsonb_build_object('ok', true, 'bet_id', v_bet_id);
END;
$$;

-- ─── self_bet_confirm_deposit ────────────────────────────────────────────────
-- Credit a verified on-chain escrow deposit: pending → held. The edge function has
-- already confirmed the Payment to the treasury on-chain. Idempotent on the deposit
-- tx hash, so a retried confirmation never double-applies.
CREATE OR REPLACE FUNCTION public.self_bet_confirm_deposit(
  p_bet_id       UUID,
  p_user_id      UUID,
  p_amount_drops BIGINT,
  p_tx_hash      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_bet public.self_bets%ROWTYPE;
BEGIN
  IF p_amount_drops <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT * INTO v_bet FROM public.self_bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bet_not_found');
  END IF;
  IF v_bet.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_bet.stake_type <> 'xrp' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_xrp');
  END IF;
  -- Idempotent replay of the same deposit.
  IF v_bet.escrow_status = 'held' AND v_bet.deposit_tx_hash = p_tx_hash THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true, 'escrow_status', 'held');
  END IF;
  IF v_bet.escrow_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_escrow_state', 'escrow_status', v_bet.escrow_status);
  END IF;

  UPDATE public.self_bets
  SET escrow_status   = 'held',
      escrow_drops    = p_amount_drops,
      deposit_tx_hash = p_tx_hash
  WHERE id = p_bet_id;

  RETURN jsonb_build_object('ok', true, 'escrow_status', 'held', 'escrow_drops', p_amount_drops);
END;
$$;

-- ─── settle_self_bet (redefined) ─────────────────────────────────────────────
-- Closes a bet given the server-measured final metric. Win is computed from the
-- bet's own baseline/target so it can never be spoofed. Token WIN credits the stake
-- back (unchanged). For an XRP escrow bet: a LOSS forfeits the already-held funds to
-- the treasury in this same transaction (escrow → 'forfeited', no on-chain move); a
-- WIN leaves the escrow 'held' so the edge function can refund it on-chain. Now takes
-- a row lock (FOR UPDATE) to serialize concurrent settle attempts. Idempotent.
CREATE OR REPLACE FUNCTION public.settle_self_bet(
  p_bet_id      UUID,
  p_final_value NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet    public.self_bets%ROWTYPE;
  v_won    BOOLEAN;
  v_escrow TEXT;
BEGIN
  SELECT * INTO v_bet FROM public.self_bets WHERE id = p_bet_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bet_not_found');
  END IF;

  IF v_bet.status <> 'active' THEN
    -- Already settled — return the prior outcome (idempotent)
    RETURN jsonb_build_object(
      'ok', true, 'status', v_bet.status, 'already_settled', true,
      'stake_type', v_bet.stake_type, 'stake_amount', v_bet.stake_amount,
      'wallet', v_bet.wallet_address,
      'escrow_status', v_bet.escrow_status, 'escrow_drops', v_bet.escrow_drops);
  END IF;

  v_won := (p_final_value - v_bet.baseline) >= v_bet.target_count;

  -- Token win → return the staked amount to the user.
  IF v_won AND v_bet.stake_type = 'tokens' THEN
    UPDATE public.user_profiles
    SET    tokens = tokens + v_bet.stake_amount
    WHERE  user_id = v_bet.user_id;
  END IF;

  -- XRP escrow: a LOSS forfeits the held funds to the treasury (the house) right
  -- here — no on-chain move. A WIN stays 'held' for the edge fn to refund on-chain.
  v_escrow := v_bet.escrow_status;
  IF v_bet.stake_type = 'xrp' AND v_bet.escrow_status = 'held' AND NOT v_won THEN
    v_escrow := 'forfeited';
  END IF;

  UPDATE public.self_bets
  SET    status        = CASE WHEN v_won THEN 'won' ELSE 'lost' END,
         final_value   = p_final_value,
         settled_at    = NOW(),
         escrow_status = v_escrow
  WHERE  id = p_bet_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'status',       CASE WHEN v_won THEN 'won' ELSE 'lost' END,
    'won',          v_won,
    'stake_type',   v_bet.stake_type,
    'stake_amount', v_bet.stake_amount,
    'wallet',       v_bet.wallet_address,
    'escrow_status', v_escrow,
    'escrow_drops', v_bet.escrow_drops
  );
END;
$$;

-- ─── self_bet_begin_refund ───────────────────────────────────────────────────
-- Reserve the WIN refund payout: held → settling, under a row lock. Returns
-- 'reserved' = true ONLY for the call that actually performed the transition, so two
-- concurrent settles can never both submit a refund (the loser gets reserved=false
-- and must NOT send — the in-flight payout is left to the reconcile job).
CREATE OR REPLACE FUNCTION public.self_bet_begin_refund(p_bet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_bet public.self_bets%ROWTYPE; v_rows INT;
BEGIN
  SELECT * INTO v_bet FROM public.self_bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bet_not_found');
  END IF;
  IF v_bet.stake_type <> 'xrp' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_xrp');
  END IF;
  IF v_bet.status <> 'won' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_won');
  END IF;
  IF v_bet.escrow_status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'already_final', true, 'escrow_status', 'refunded');
  END IF;
  IF v_bet.escrow_status NOT IN ('held', 'settling') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_escrow_state', 'escrow_status', v_bet.escrow_status);
  END IF;

  UPDATE public.self_bets
  SET escrow_status = 'settling'
  WHERE id = p_bet_id AND escrow_status = 'held';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'reserved', v_rows > 0, 'escrow_status', 'settling',
    'escrow_drops', v_bet.escrow_drops, 'wallet', v_bet.wallet_address);
END;
$$;

-- ─── self_bet_finalize_refund ────────────────────────────────────────────────
-- After the edge fn submits the on-chain refund: on success → refunded + tx hash;
-- on failure → revert to 'held' so it can be retried. Idempotent on escrow state.
CREATE OR REPLACE FUNCTION public.self_bet_finalize_refund(
  p_bet_id  UUID,
  p_success BOOLEAN,
  p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_bet public.self_bets%ROWTYPE;
BEGIN
  SELECT * INTO v_bet FROM public.self_bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bet_not_found');
  END IF;
  IF v_bet.escrow_status <> 'settling' THEN
    RETURN jsonb_build_object('ok', true, 'already_final', true, 'escrow_status', v_bet.escrow_status);
  END IF;

  IF p_success THEN
    UPDATE public.self_bets
    SET escrow_status = 'refunded', payout_tx_hash = p_tx_hash
    WHERE id = p_bet_id;
    RETURN jsonb_build_object('ok', true, 'escrow_status', 'refunded');
  ELSE
    UPDATE public.self_bets SET escrow_status = 'held' WHERE id = p_bet_id;
    RETURN jsonb_build_object('ok', true, 'escrow_status', 'held');
  END IF;
END;
$$;

-- ─── self_bet_set_pending_hash ───────────────────────────────────────────────
-- Persist the on-chain refund tx hash on a 'settling' bet that submitted but did not
-- confirm within the edge fn's poll window, so the reconcile job can look it up and
-- finalize later. Only touches a 'settling' row; never re-credits or moves state.
CREATE OR REPLACE FUNCTION public.self_bet_set_pending_hash(
  p_bet_id  UUID,
  p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows INT;
BEGIN
  UPDATE public.self_bets
  SET payout_tx_hash = p_tx_hash
  WHERE id = p_bet_id AND escrow_status = 'settling';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_rows > 0);
END;
$$;

-- These RPCs move money / change escrow state and must never be callable by app
-- clients. Only the service role (used by the `self-bet` edge function) may execute.
REVOKE ALL ON FUNCTION public.open_self_bet                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_self_bet               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_bet_confirm_deposit(UUID, UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_bet_begin_refund(UUID)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_bet_finalize_refund(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_bet_set_pending_hash(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_self_bet                 TO service_role;
GRANT  EXECUTE ON FUNCTION public.settle_self_bet               TO service_role;
GRANT  EXECUTE ON FUNCTION public.self_bet_confirm_deposit(UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.self_bet_begin_refund(UUID)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.self_bet_finalize_refund(UUID, BOOLEAN, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.self_bet_set_pending_hash(UUID, TEXT) TO service_role;
