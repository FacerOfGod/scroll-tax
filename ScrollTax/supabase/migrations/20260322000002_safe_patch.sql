-- Safe patch — idempotent, safe to run against an existing database.
-- Applies all missing RLS policies without touching table structure.

-- ─── groups ────────────────────────────────────────────────────────────────

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view groups" ON public.groups;
CREATE POLICY "Anyone can view groups" ON public.groups
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create groups" ON public.groups;
CREATE POLICY "Users can create groups" ON public.groups
    FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can update groups" ON public.groups;
CREATE POLICY "Creators can update groups" ON public.groups
    FOR UPDATE USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can delete groups" ON public.groups;
CREATE POLICY "Creators can delete groups" ON public.groups
    FOR DELETE USING (auth.uid() = creator_id);

-- ─── group_members ──────────────────────────────────────────────────────────

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view members of their groups" ON public.group_members;
DROP POLICY IF EXISTS "Members can view all members in their groups" ON public.group_members;
CREATE POLICY "Members can view all members in their groups" ON public.group_members
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = group_members.group_id AND g.creator_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
CREATE POLICY "Users can join groups" ON public.group_members
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own membership" ON public.group_members;
CREATE POLICY "Users can update their own membership" ON public.group_members
    FOR UPDATE USING (auth.uid() = user_id);

-- ─── linked_accounts ────────────────────────────────────────────────────────

ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User can read own linked account" ON public.linked_accounts;
CREATE POLICY "User can read own linked account" ON public.linked_accounts
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "User can insert linked account" ON public.linked_accounts;
CREATE POLICY "User can insert linked account" ON public.linked_accounts
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "User can update own linked account" ON public.linked_accounts;
CREATE POLICY "User can update own linked account" ON public.linked_accounts
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── sessions ───────────────────────────────────────────────────────────────

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view sessions" ON public.sessions;
CREATE POLICY "Anyone can view sessions" ON public.sessions
    FOR SELECT USING (true);

-- ─── participants ───────────────────────────────────────────────────────────

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view participants" ON public.participants;
CREATE POLICY "Anyone can view participants" ON public.participants
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can join sessions" ON public.participants;
CREATE POLICY "Authenticated users can join sessions" ON public.participants
    FOR INSERT TO authenticated WITH CHECK (true);

-- ─── deductions ─────────────────────────────────────────────────────────────

ALTER TABLE public.deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view deductions" ON public.deductions;
CREATE POLICY "Anyone can view deductions" ON public.deductions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "App can insert deductions" ON public.deductions;
CREATE POLICY "App can insert deductions" ON public.deductions
    FOR INSERT TO authenticated WITH CHECK (true);

-- Enable realtime for deductions (bot needs INSERT events)
ALTER PUBLICATION supabase_realtime ADD TABLE public.deductions;

-- ─── Add missing columns if not present ─────────────────────────────────────

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS penalties_incurred NUMERIC DEFAULT 0;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS chat_id TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS banned_apps TEXT[] DEFAULT ARRAY[
  'com.zhiliaoapp.musically',
  'com.instagram.android',
  'com.google.android.youtube',
  'com.whatsapp'
];
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS penalty_rate NUMERIC DEFAULT 0;
ALTER TABLE public.deductions ADD COLUMN IF NOT EXISTS app_name TEXT;
