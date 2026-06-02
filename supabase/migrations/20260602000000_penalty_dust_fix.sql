-- ============================================================
-- record_penalty: fix token dust loss on multi-member splits
-- ============================================================
-- The original split (20260330000001) credited every other active member an
-- equal FLOOR'd share but discarded the flooring remainder, so the penalised
-- user was debited the full amount while strictly less than that was credited
-- back — tokens silently vanished from the system on every split that didn't
-- divide evenly (e.g. 1 token / 3 members → 0.999999 distributed).
--
-- Redefine the function so the remainder (amount - share*N) is credited to the
-- first member, guaranteeing distributed total == amount deducted. Only the
-- distribution block changed; all other logic is identical to the original.

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
  v_member_count  INTEGER;
  v_rows_updated  INTEGER;
  v_share         NUMERIC;
  v_remainder     NUMERIC;
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

    v_member_count := COALESCE(array_length(v_other_ids, 1), 0);
    IF v_member_count > 0 THEN
      v_share := FLOOR((v_penalty_amt / v_member_count) * 1e6) / 1e6;
      -- Equal floored share to every other active member
      UPDATE public.user_profiles
      SET    tokens = tokens + v_share
      WHERE  user_id = ANY(v_other_ids);

      -- Route the flooring remainder to the first member so the total credited
      -- equals the amount deducted — no tokens leak out of the system.
      v_remainder := v_penalty_amt - (v_share * v_member_count);
      IF v_remainder > 0 THEN
        UPDATE public.user_profiles
        SET    tokens = tokens + v_remainder
        WHERE  user_id = v_other_ids[1];
      END IF;
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
