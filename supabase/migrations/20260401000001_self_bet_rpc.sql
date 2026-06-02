-- ─── Self-bet stake RPCs ────────────────────────────────────────────────────
-- Both run as SECURITY DEFINER and are callable ONLY by service_role (the
-- self-bet edge function). The edge function is what captures the baseline /
-- final metric server-side from the provider API, so these functions trust the
-- numeric values it passes but keep the token-ledger math atomic.

-- open_self_bet: locks the stake (token path deducts up-front) and inserts an
-- active bet in a single transaction. Returns the new bet id, or an error.
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
    period_end, stake_amount, stake_type, wallet_address
  )
  VALUES (
    p_user_id, p_provider, p_metric, p_target, COALESCE(p_baseline, 0),
    p_period_end, p_stake_amount, p_stake_type, p_wallet
  )
  RETURNING id INTO v_bet_id;

  RETURN jsonb_build_object('ok', true, 'bet_id', v_bet_id);
END;
$$;

REVOKE ALL ON FUNCTION public.open_self_bet FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_self_bet TO service_role;

-- settle_self_bet: closes a bet given the server-measured final metric value.
-- Win condition is computed here from the bet's own baseline/target so it can
-- never be spoofed. On a token WIN the stake is credited back; on a LOSS it
-- stays forfeited (already deducted at open time → goes to the house). For XRP
-- the caller (edge fn → client) performs the on-chain forfeit; this only marks
-- status. Idempotent: a no-op if the bet is already settled.
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
  v_bet  RECORD;
  v_won  BOOLEAN;
BEGIN
  SELECT * INTO v_bet FROM public.self_bets WHERE id = p_bet_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bet_not_found');
  END IF;

  IF v_bet.status <> 'active' THEN
    -- Already settled — return the prior outcome (idempotent)
    RETURN jsonb_build_object('ok', true, 'status', v_bet.status, 'already_settled', true);
  END IF;

  v_won := (p_final_value - v_bet.baseline) >= v_bet.target_count;

  -- Token win → return the staked amount to the user.
  IF v_won AND v_bet.stake_type = 'tokens' THEN
    UPDATE public.user_profiles
    SET    tokens = tokens + v_bet.stake_amount
    WHERE  user_id = v_bet.user_id;
  END IF;

  UPDATE public.self_bets
  SET    status      = CASE WHEN v_won THEN 'won' ELSE 'lost' END,
         final_value = p_final_value,
         settled_at  = NOW()
  WHERE  id = p_bet_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'status',      CASE WHEN v_won THEN 'won' ELSE 'lost' END,
    'won',         v_won,
    'stake_type',  v_bet.stake_type,
    'stake_amount', v_bet.stake_amount,
    'wallet',      v_bet.wallet_address
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_self_bet FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_self_bet TO service_role;
