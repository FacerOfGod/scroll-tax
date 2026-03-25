-- ============================================================
-- ScrollTax — full schema (single authoritative migration)
-- ============================================================

-- ─── Drop existing tables (FK order: children first) ─────────
-- Telegram/TON bot tables are dropped here to clean the remote
-- but are NOT recreated (bot removed on this branch).

DROP TABLE IF EXISTS public.deductions      CASCADE;
DROP TABLE IF EXISTS public.participants    CASCADE;
DROP TABLE IF EXISTS public.sessions        CASCADE;
DROP TABLE IF EXISTS public.ton_wallets     CASCADE;
DROP TABLE IF EXISTS public.linked_accounts CASCADE;
DROP TABLE IF EXISTS public.group_members   CASCADE;
DROP TABLE IF EXISTS public.groups          CASCADE;

-- ─── App tables ───────────────────────────────────────────────

CREATE TABLE public.groups (
    id                           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    name                         TEXT    NOT NULL,
    creator_id                   UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address               TEXT,
    min_deposit                  NUMERIC NOT NULL DEFAULT 0,
    duration_days                INTEGER NOT NULL DEFAULT 7,
    penalty_amount               NUMERIC NOT NULL DEFAULT 0,
    penalty_trigger_time_minutes INTEGER NOT NULL DEFAULT 10,
    banned_apps                  TEXT[]  NOT NULL DEFAULT ARRAY[
        'com.zhiliaoapp.musically',
        'com.instagram.android',
        'com.google.android.youtube',
        'com.whatsapp'
    ],
    status                       TEXT    NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'ended')),
    created_at                   TIMESTAMP WITH TIME ZONE
                                     DEFAULT timezone('utc', now()) NOT NULL,
    end_time                     TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.group_members (
    id                 UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id           UUID    NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id            UUID    NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
    wallet_address     TEXT,
    staked_amount      NUMERIC NOT NULL DEFAULT 0 CHECK (staked_amount      >= 0),
    penalties_incurred NUMERIC NOT NULL DEFAULT 0 CHECK (penalties_incurred >= 0),
    joined_at          TIMESTAMP WITH TIME ZONE
                           DEFAULT timezone('utc', now()) NOT NULL,
    status             TEXT    NOT NULL DEFAULT 'active',
    UNIQUE(group_id, user_id)
);

-- ─── Enable Row Level Security ────────────────────────────────

ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- ─── Policies: groups ─────────────────────────────────────────

-- Public read so any user can browse and join groups
CREATE POLICY "Anyone can view groups" ON public.groups
    FOR SELECT USING (true);

-- TO authenticated prevents anon inserts before the WITH CHECK runs
CREATE POLICY "Authenticated users can create groups" ON public.groups
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = creator_id);

-- WITH CHECK prevents transferring ownership by updating creator_id
CREATE POLICY "Creators can update their group" ON public.groups
    FOR UPDATE TO authenticated
    USING    (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their group" ON public.groups
    FOR DELETE TO authenticated
    USING (auth.uid() = creator_id);

-- ─── Helper: membership check (bypasses RLS to avoid infinite recursion) ─────

-- SECURITY DEFINER runs as the function owner, so the inner SELECT on
-- group_members is NOT subject to RLS — breaking the self-referential cycle.
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

-- ─── Policies: group_members ──────────────────────────────────

-- All members of a group can see the full member list (leaderboard).
CREATE POLICY "Members can view all members in their groups" ON public.group_members
    FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));

-- WITH CHECK ensures a user can only insert a row for themselves
CREATE POLICY "Authenticated users can join groups" ON public.group_members
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- WITH CHECK prevents changing user_id to hijack another member's stake
CREATE POLICY "Members can update their own membership" ON public.group_members
    FOR UPDATE TO authenticated
    USING    (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Allows a member to leave a group
CREATE POLICY "Members can leave groups" ON public.group_members
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ─── Realtime ─────────────────────────────────────────────────

-- GroupDashboard subscribes to group_members for live leaderboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
