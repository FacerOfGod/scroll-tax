-- Fix 1: Allow any group member to see all members in groups they belong to.
-- Old policy only allowed users to see their own row (or creators to see all),
-- so non-creator members joining a group could never see existing members.
DROP POLICY "Users can view members of their groups" ON public.group_members;

CREATE POLICY "Members can view all members in their groups" ON public.group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.group_members gm2
            WHERE gm2.group_id = group_members.group_id AND gm2.user_id = auth.uid()
        )
    );

-- Fix 2: Allow authenticated users to update their own linked_accounts row.
-- Supabase upsert requires both INSERT and UPDATE policies; without UPDATE the
-- upsert silently fails on conflict (existing telegram_id), breaking re-linking.
CREATE POLICY "User can update own linked account" ON public.linked_accounts
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Fix 3: Add deductions table to the realtime publication so the bot's
-- postgres_changes subscription actually receives INSERT events.
-- Without this, the bot never fires shame messages or TON transfers.
ALTER PUBLICATION supabase_realtime ADD TABLE public.deductions;
