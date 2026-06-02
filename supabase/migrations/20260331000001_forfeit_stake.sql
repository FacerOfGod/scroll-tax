-- forfeit_stake: called when a user revokes app usage access during an active session.
-- Distributes their remaining stake to other active members (token groups only),
-- zeroes their staked_amount, marks them as 'left', and records a penalty event.

CREATE OR REPLACE FUNCTION public.forfeit_stake(p_group_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_member     RECORD;
  v_group      RECORD;
  v_other_ids  UUID[];
  v_share      NUMERIC;
BEGIN
  -- Verify caller is an active member of this group
  SELECT * INTO v_member
  FROM   public.group_members
  WHERE  group_id = p_group_id AND user_id = v_user_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_active_member');
  END IF;

  -- Verify the group is still active
  SELECT * INTO v_group
  FROM   public.groups
  WHERE  id = p_group_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_not_active');
  END IF;

  -- For token groups: distribute remaining stake to other active members
  IF v_group.stake_type = 'tokens' AND v_member.staked_amount > 0 THEN
    SELECT ARRAY_AGG(user_id) INTO v_other_ids
    FROM   public.group_members
    WHERE  group_id = p_group_id AND user_id <> v_user_id AND status = 'active';

    IF v_other_ids IS NOT NULL AND array_length(v_other_ids, 1) > 0 THEN
      v_share := FLOOR((v_member.staked_amount / array_length(v_other_ids, 1)) * 1e6) / 1e6;
      UPDATE public.user_profiles
      SET    tokens = tokens + v_share
      WHERE  user_id = ANY(v_other_ids);
    END IF;
  END IF;

  -- Zero out stake, mark as left (XRP stays in group wallet; handled by group end logic)
  UPDATE public.group_members
  SET    staked_amount      = 0,
         penalties_incurred = penalties_incurred + v_member.staked_amount,
         status             = 'left',
         left_at            = NOW()
  WHERE  id = v_member.id;

  -- Audit record
  INSERT INTO public.penalty_events (group_id, user_id, amount, app_package, fired_at)
  VALUES (p_group_id, v_user_id, v_member.staked_amount, 'permission_revoked', NOW());

  RETURN jsonb_build_object('ok', true, 'amount', v_member.staked_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_stake(UUID) TO authenticated;
