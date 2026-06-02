-- ============================================================
-- Active-member visibility fix + atomic token-adjust RPC
-- ============================================================

-- ─── 1. Make is_group_member active-only ─────────────────────────────────────
-- The live group_members SELECT policy calls the 2-arg is_group_member(group_id,
-- auth.uid()), which had no status filter — so members who had "left" a group
-- were still visible on the leaderboard and counted as members. A previously
-- added 1-arg active-only overload was never wired to any policy. Redefine the
-- 2-arg function to exclude left members, and drop the dead 1-arg overload.

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id
          AND user_id  = p_user_id
          AND status   = 'active'
    );
$$;

DROP FUNCTION IF EXISTS public.is_group_member(UUID);

-- Mirror the active-only rule for the penalty-events log so left members can no
-- longer read a group's penalty history.
DROP POLICY IF EXISTS "Group members can view penalty events" ON public.penalty_events;
CREATE POLICY "Group members can view penalty events" ON public.penalty_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = penalty_events.group_id
        AND gm.user_id  = auth.uid()
        AND gm.status   = 'active'
    )
  );

-- ─── 2. Atomic token-adjust RPC ──────────────────────────────────────────────
-- Replaces the client-side read-then-write deduct/add in TokenService, which
-- could race (two concurrent deducts → negative balance, or a lost update).
-- Operates only on the caller's own row; the guarded WHERE keeps the balance
-- from going negative in a single atomic statement.

CREATE OR REPLACE FUNCTION public.adjust_tokens(p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new     NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.user_profiles
  SET    tokens = tokens + p_delta
  WHERE  user_id = v_user_id
    AND  tokens + p_delta >= 0
  RETURNING tokens INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_tokens';
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL    ON FUNCTION public.adjust_tokens(NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_tokens(NUMERIC) TO authenticated;
