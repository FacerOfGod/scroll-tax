-- ============================================================
-- Custodial (omnibus) treasury — internal ledger + audit log
-- ============================================================
-- Phase 2 custody model: a single backend-controlled treasury XRPL account holds
-- all group stakes on-chain (multisig SignerList in production; see treasury edge
-- function). Ownership of those pooled funds is tracked here, in the DB, per
-- (group, member). All balances are stored in integer DROPS (1 XRP = 1e6 drops)
-- to avoid floating-point drift.
--
-- Writes happen ONLY through the SECURITY DEFINER RPCs below, which the `treasury`
-- edge function calls with the service role after verifying / signing on-chain.
-- Clients can read their own rows but can never mint or move balance directly.

-- ─── per-member held balance ─────────────────────────────────────────────────
CREATE TABLE public.treasury_ledger (
  group_id      UUID   NOT NULL REFERENCES public.groups(id)  ON DELETE CASCADE,
  user_id       UUID   NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  balance_drops BIGINT NOT NULL DEFAULT 0 CHECK (balance_drops >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE public.treasury_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own treasury balance" ON public.treasury_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─── append-only audit log of every deposit / payout ─────────────────────────
CREATE TABLE public.treasury_transactions (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id        UUID    NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id         UUID    NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  kind            TEXT    NOT NULL CHECK (kind IN
                    ('deposit', 'penalty_payout', 'group_end_payout', 'refund')),
  amount_drops    BIGINT  NOT NULL CHECK (amount_drops > 0),
  onchain_tx_hash TEXT,                       -- verified deposit tx, or signed payout tx
  idempotency_key TEXT    NOT NULL UNIQUE,    -- blocks double-credit / double-payout
  status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own treasury transactions" ON public.treasury_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─── credit (confirmed deposit) ──────────────────────────────────────────────
-- Idempotent on idempotency_key (= the on-chain deposit tx hash). Records the
-- audit row and increments the member's held balance in one transaction.
CREATE OR REPLACE FUNCTION public.treasury_credit(
  p_group_id UUID, p_user_id UUID, p_amount_drops BIGINT,
  p_tx_hash TEXT, p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted INT; v_balance BIGINT;
BEGIN
  IF p_amount_drops <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  INSERT INTO public.treasury_transactions
    (group_id, user_id, kind, amount_drops, onchain_tx_hash, idempotency_key, status)
  VALUES (p_group_id, p_user_id, 'deposit', p_amount_drops, p_tx_hash, p_idempotency_key, 'confirmed')
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true);
  END IF;

  INSERT INTO public.treasury_ledger (group_id, user_id, balance_drops)
  VALUES (p_group_id, p_user_id, p_amount_drops)
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET balance_drops = treasury_ledger.balance_drops + EXCLUDED.balance_drops,
        updated_at    = timezone('utc', now())
  RETURNING balance_drops INTO v_balance;

  RETURN jsonb_build_object('ok', true, 'balance_drops', v_balance);
END; $$;

-- ─── reserve/debit (start a payout) ──────────────────────────────────────────
-- Atomically reserves funds BEFORE the on-chain payout so we can never pay out
-- more than a member holds. Records a 'pending' audit row; the guarded UPDATE
-- aborts the whole tx if the balance is insufficient. Finalized later.
CREATE OR REPLACE FUNCTION public.treasury_debit(
  p_group_id UUID, p_user_id UUID, p_amount_drops BIGINT,
  p_kind TEXT, p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted INT; v_rows INT; v_balance BIGINT;
BEGIN
  IF p_amount_drops <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF p_kind NOT IN ('penalty_payout', 'group_end_payout', 'refund') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kind');
  END IF;

  INSERT INTO public.treasury_transactions
    (group_id, user_id, kind, amount_drops, idempotency_key, status)
  VALUES (p_group_id, p_user_id, p_kind, p_amount_drops, p_idempotency_key, 'pending')
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true);
  END IF;

  UPDATE public.treasury_ledger
  SET balance_drops = balance_drops - p_amount_drops,
      updated_at    = timezone('utc', now())
  WHERE group_id = p_group_id AND user_id = p_user_id
    AND balance_drops >= p_amount_drops
  RETURNING balance_drops INTO v_balance;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- abort: rolls back the pending audit insert too, keeping ledger consistent
    RAISE EXCEPTION 'insufficient_treasury_balance';
  END IF;

  RETURN jsonb_build_object('ok', true, 'balance_drops', v_balance);
END; $$;

-- ─── finalize a payout ───────────────────────────────────────────────────────
-- After the edge function submits the on-chain payout: on success, stamp the tx
-- hash and confirm; on failure, re-credit the reserved amount and mark failed.
CREATE OR REPLACE FUNCTION public.treasury_finalize_payout(
  p_idempotency_key TEXT, p_success BOOLEAN, p_tx_hash TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txn public.treasury_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_txn FROM public.treasury_transactions
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_payout');
  END IF;
  IF v_txn.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'already_final', true, 'status', v_txn.status);
  END IF;

  IF p_success THEN
    UPDATE public.treasury_transactions
    SET status = 'confirmed', onchain_tx_hash = p_tx_hash
    WHERE id = v_txn.id;
  ELSE
    UPDATE public.treasury_transactions SET status = 'failed' WHERE id = v_txn.id;
    -- compensate: return the reserved funds to the member
    UPDATE public.treasury_ledger
    SET balance_drops = balance_drops + v_txn.amount_drops,
        updated_at    = timezone('utc', now())
    WHERE group_id = v_txn.group_id AND user_id = v_txn.user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_success THEN 'confirmed' ELSE 'failed' END);
END; $$;

-- These RPCs move money and must never be callable by app clients. Only the
-- service role (used by the `treasury` edge function) may execute them.
REVOKE ALL ON FUNCTION public.treasury_credit(UUID, UUID, BIGINT, TEXT, TEXT)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_debit(UUID, UUID, BIGINT, TEXT, TEXT)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_finalize_payout(TEXT, BOOLEAN, TEXT)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treasury_credit(UUID, UUID, BIGINT, TEXT, TEXT)     TO service_role;
GRANT EXECUTE ON FUNCTION public.treasury_debit(UUID, UUID, BIGINT, TEXT, TEXT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.treasury_finalize_payout(TEXT, BOOLEAN, TEXT)       TO service_role;
