-- ============================================================
-- Treasury payout reconciliation support
-- ============================================================
-- When a payout is submitted but not yet validated within the edge function's
-- poll window, its treasury_transactions row stays 'pending' with the funds
-- already reserved (debited). The reconcile job (treasury edge function) later
-- resolves these rows against the ledger — but it needs the on-chain tx hash to
-- look them up, and the hash is only known AFTER signing. This RPC persists the
-- hash onto a still-pending row so reconciliation can find and finalize it.

CREATE OR REPLACE FUNCTION public.treasury_set_pending_hash(
  p_idempotency_key TEXT, p_tx_hash TEXT
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.treasury_transactions
  SET    onchain_tx_hash = p_tx_hash
  WHERE  idempotency_key = p_idempotency_key
    AND  status = 'pending';
$$;

REVOKE ALL    ON FUNCTION public.treasury_set_pending_hash(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treasury_set_pending_hash(TEXT, TEXT) TO service_role;

-- Fast scan for the reconcile job: pending rows ordered by age.
CREATE INDEX IF NOT EXISTS treasury_transactions_pending_idx
  ON public.treasury_transactions (created_at)
  WHERE status = 'pending';
