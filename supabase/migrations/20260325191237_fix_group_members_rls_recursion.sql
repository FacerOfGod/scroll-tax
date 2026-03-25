-- Fix infinite recursion in group_members SELECT policy.
-- The old policy queried group_members inside its own USING clause,
-- causing PostgreSQL to recurse indefinitely.
-- A SECURITY DEFINER function bypasses RLS on the inner query, breaking the cycle.

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id
          AND user_id  = auth.uid()
    );
$$;

DROP POLICY IF EXISTS "Members can view all members in their groups" ON public.group_members;

CREATE POLICY "Members can view all members in their groups" ON public.group_members
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));
