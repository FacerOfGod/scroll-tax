-- ============================================================
-- Penalty redistribution through the treasury + ledger read access
-- ============================================================
-- With group stakes now held in the custodial treasury, an XRP penalty is an
-- INTERNAL ledger transfer (no per-penalty on-chain tx / fee): debit the
-- offender's held balance and credit the other active members, in drops, with
-- the flooring remainder going to the first member. Funds only leave the
-- treasury on-chain at group end (see the `settle_group` edge action).
--
-- record_penalty is redefined to add this XRP branch; the token branch and all
-- other logic are unchanged from 20260602000000. The redistribution only runs
-- when the offender actually has a treasury balance, so legacy (non-treasury)
-- groups are unaffected.

-- Let group members read each other's treasury balances (for the leaderboard),
-- alongside the existing own-row policy. Mirrors the penalty_events visibility.
CREATE POLICY "Group members read group treasury balances" ON public.treasury_ledger
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = treasury_ledger.group_id
        AND gm.user_id  = auth.uid()
        AND gm.status   = 'active'
    )
  );

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
  -- treasury (XRP) redistribution, all in integer drops
  v_offender_bal  BIGINT;
  v_penalty_drops BIGINT;
  v_actual_drops  BIGINT;
  v_share_drops   BIGINT;
  v_rem_drops     BIGINT;
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

  -- 4a. Token path: atomic deduct-then-distribute
  IF v_stake_type = 'tokens' THEN
    UPDATE public.user_profiles
    SET    tokens = tokens - v_penalty_amt
    WHERE  user_id = v_user_id AND tokens >= v_penalty_amt;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_tokens');
    END IF;

    SELECT ARRAY_AGG(user_id) INTO v_other_ids
    FROM   public.group_members
    WHERE  group_id = p_group_id AND user_id <> v_user_id AND status = 'active';

    v_member_count := COALESCE(array_length(v_other_ids, 1), 0);
    IF v_member_count > 0 THEN
      v_share := FLOOR((v_penalty_amt / v_member_count) * 1e6) / 1e6;
      UPDATE public.user_profiles
      SET    tokens = tokens + v_share
      WHERE  user_id = ANY(v_other_ids);

      v_remainder := v_penalty_amt - (v_share * v_member_count);
      IF v_remainder > 0 THEN
        UPDATE public.user_profiles
        SET    tokens = tokens + v_remainder
        WHERE  user_id = v_other_ids[1];
      END IF;
    END IF;

  -- 4b. XRP path: redistribute the held treasury balance internally (no on-chain
  --     tx). Only runs for treasury-backed groups (offender has a ledger row).
  ELSIF v_stake_type = 'xrp' THEN
    v_penalty_drops := ROUND(v_penalty_amt * 1e6);

    SELECT balance_drops INTO v_offender_bal
    FROM   public.treasury_ledger
    WHERE  group_id = p_group_id AND user_id = v_user_id
    FOR UPDATE;

    IF FOUND AND v_offender_bal > 0 THEN
      v_actual_drops := LEAST(v_penalty_drops, v_offender_bal);  -- never go negative

      UPDATE public.treasury_ledger
      SET    balance_drops = balance_drops - v_actual_drops,
             updated_at    = timezone('utc', now())
      WHERE  group_id = p_group_id AND user_id = v_user_id;

      SELECT ARRAY_AGG(user_id) INTO v_other_ids
      FROM   public.group_members
      WHERE  group_id = p_group_id AND user_id <> v_user_id AND status = 'active';

      v_member_count := COALESCE(array_length(v_other_ids, 1), 0);
      IF v_member_count > 0 THEN
        v_share_drops := v_actual_drops / v_member_count;            -- integer floor
        v_rem_drops   := v_actual_drops - v_share_drops * v_member_count;

        IF v_share_drops > 0 THEN
          INSERT INTO public.treasury_ledger (group_id, user_id, balance_drops)
          SELECT p_group_id, uid, v_share_drops FROM unnest(v_other_ids) AS uid
          ON CONFLICT (group_id, user_id) DO UPDATE
            SET balance_drops = treasury_ledger.balance_drops + EXCLUDED.balance_drops,
                updated_at    = timezone('utc', now());
        END IF;

        IF v_rem_drops > 0 THEN
          INSERT INTO public.treasury_ledger (group_id, user_id, balance_drops)
          VALUES (p_group_id, v_other_ids[1], v_rem_drops)
          ON CONFLICT (group_id, user_id) DO UPDATE
            SET balance_drops = treasury_ledger.balance_drops + EXCLUDED.balance_drops,
                updated_at    = timezone('utc', now());
        END IF;
      END IF;
      -- (no other active members: the offender's debited drops stay in the
      --  treasury and are reconciled to the house at group end.)
    END IF;
  END IF;

  -- 5. Update member penalty stats (legacy display fields)
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
