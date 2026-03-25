-- Clean up all INSERT/UPDATE/DELETE policies on group_members that may have
-- been left in conflicting states by previous migrations, then recreate them
-- in a single known-good state.

-- Drop every possible policy name that any past migration may have created
DROP POLICY IF EXISTS "Authenticated users can join groups"  ON public.group_members;
DROP POLICY IF EXISTS "Users can join groups"               ON public.group_members;
DROP POLICY IF EXISTS "Members can update their own membership" ON public.group_members;
DROP POLICY IF EXISTS "Users can update their own membership"   ON public.group_members;
DROP POLICY IF EXISTS "Members can leave groups"            ON public.group_members;

-- Recreate cleanly
CREATE POLICY "Users can join groups" ON public.group_members
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own membership" ON public.group_members
    FOR UPDATE TO authenticated
    USING    (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave groups" ON public.group_members
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);
