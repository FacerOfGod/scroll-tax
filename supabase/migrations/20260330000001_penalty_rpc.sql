-- ─── penalty_events audit table ──────────────────────────────────────────────
-- Clients cannot INSERT directly — all writes go through record_penalty().

CREATE TABLE public.penalty_events (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    UUID    NOT NULL REFERENCES public.groups(id)  ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  tx_hash     TEXT,
  tx_verified BOOLEAN DEFAULT NULL,  -- NULL = pending, TRUE = on-chain, FALSE = spoofed
  app_package TEXT,
  fired_at    TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.penalty_events ENABLE ROW LEVEL SECURITY;

-- Members of the same group can read the event log.
-- Inline subquery avoids dependency on is_group_member's signature across migrations.
CREATE POLICY "Group members can view penalty events" ON public.penalty_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = penalty_events.group_id
        AND gm.user_id  = auth.uid()
    )
  );

-- No INSERT policy — only record_penalty() (SECURITY DEFINER) can write rows

-- ─── record_penalty RPC ───────────────────────────────────────────────────────
-- Server-authoritative: reads penalty_amount from the groups row (never trusts
-- the client-supplied value). Atomically deducts tokens, distributes shares to
-- active members, rate-limits per threshold window, and writes the audit event.
--
-- SECURITY DEFINER so cross-user token UPDATEs work without opening RLS.

CREATE OR REPLACE FUNCTION public.record_penalty(
  p_group_id    UUID,
  p_app_package TEXT,
  p_tx_hash     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID    := auth.uid();
  v_penalty_amt   NUMERIC;
  v_group_status  TEXT;
  v_stake_type    TEXT;
  v_threshold_min INTEGER;
  v_last_penalty  TIMESTAMPTZ;
  v_member_id     UUID;
  v_other_ids     UUID[];
  v_rows_updated  INTEGER;
  v_share         NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- 1. Load server-authoritative group config
  SELECT penalty_amount, status, stake_type, penalty_trigger_time_minutes
  INTO   v_penalty_amt, v_group_status, v_stake_type, v_threshold_min
  FROM   public.groups
  WHERE  id = p_group_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_not_found');
  END IF;

  IF v_group_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_not_active');
  END IF;

  -- 2. Membership guard — caller must be an active member
  SELECT id INTO v_member_id
  FROM   public.group_members
  WHERE  group_id = p_group_id AND user_id = v_user_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_member');
  END IF;

  -- 3. Rate-limit: one penalty per (user, group) per threshold window
  SELECT MAX(fired_at) INTO v_last_penalty
  FROM   public.penalty_events
  WHERE  group_id = p_group_id AND user_id = v_user_id;

  IF v_last_penalty IS NOT NULL AND
     v_last_penalty >= NOW() - (v_threshold_min * INTERVAL '1 minute') THEN
    RETURN jsonb_build_object(
      'ok',          false,
      'error',       'rate_limited',
      'retry_after', EXTRACT(EPOCH FROM (
        v_last_penalty + (v_threshold_min * INTERVAL '1 minute') - NOW()
      ))::INTEGER
    );
  END IF;

  -- 4. Token path: atomic deduct-then-distribute
  IF v_stake_type = 'tokens' THEN
    -- Single-statement check-and-deduct eliminates read-then-write race
    UPDATE public.user_profiles
    SET    tokens = tokens - v_penalty_amt
    WHERE  user_id = v_user_id AND tokens >= v_penalty_amt;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_tokens');
    END IF;

    -- Distribute equally to all other active members
    SELECT ARRAY_AGG(user_id) INTO v_other_ids
    FROM   public.group_members
    WHERE  group_id = p_group_id AND user_id <> v_user_id AND status = 'active';

    IF v_other_ids IS NOT NULL AND array_length(v_other_ids, 1) > 0 THEN
      v_share := FLOOR((v_penalty_amt / array_length(v_other_ids, 1)) * 1e6) / 1e6;
      UPDATE public.user_profiles
      SET    tokens = tokens + v_share
      WHERE  user_id = ANY(v_other_ids);
    END IF;
  END IF;

  -- 5. Update member penalty stats
  UPDATE public.group_members
  SET    staked_amount      = GREATEST(0, staked_amount - v_penalty_amt),
         penalties_incurred = penalties_incurred + v_penalty_amt
  WHERE  id = v_member_id;

  -- 6. Write audit event
  INSERT INTO public.penalty_events (group_id, user_id, amount, tx_hash, app_package)
  VALUES (p_group_id, v_user_id, v_penalty_amt, p_tx_hash, p_app_package);

  RETURN jsonb_build_object('ok', true, 'amount', v_penalty_amt);
END;
$$;

REVOKE ALL ON FUNCTION public.record_penalty FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_penalty TO authenticated;
