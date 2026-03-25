-- auth.uid() can return null when called inside a SECURITY DEFINER function
-- because PostgREST evaluates it in the function-owner role context.
-- Fix: accept the user_id as a parameter so auth.uid() is evaluated by the
-- caller (the policy expression), where the JWT context is always present.

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
    );
$$;

-- Drop the policy first (it depends on the old function), then drop the function
DROP POLICY IF EXISTS "Members can view all members in their groups" ON public.group_members;
DROP FUNCTION IF EXISTS public.is_group_member(UUID);

CREATE POLICY "Members can view all members in their groups" ON public.group_members
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id, auth.uid()));
