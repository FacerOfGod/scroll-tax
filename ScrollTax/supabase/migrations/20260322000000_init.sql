-- ============================================================
-- ScrollTax — full schema (single base migration)
-- ============================================================

-- ─── App tables ──────────────────────────────────────────────

CREATE TABLE public.groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT,
    min_deposit NUMERIC NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 7,
    penalty_amount NUMERIC NOT NULL DEFAULT 0,
    penalty_trigger_time_minutes INTEGER NOT NULL DEFAULT 10,
    banned_apps TEXT[] NOT NULL DEFAULT ARRAY[
        'com.zhiliaoapp.musically',
        'com.instagram.android',
        'com.google.android.youtube',
        'com.whatsapp'
    ],
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.group_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT,
    staked_amount NUMERIC DEFAULT 0,
    penalties_incurred NUMERIC DEFAULT 0,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE(group_id, user_id)
);

-- ─── Bot tables ───────────────────────────────────────────────

-- Links a Telegram user to a Supabase auth user
CREATE TABLE public.linked_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telegram_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,  -- Supabase auth UUID stored as text
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- TON focus sessions created via the bot
CREATE TABLE public.sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    duration INTEGER NOT NULL,   -- minutes
    stake NUMERIC NOT NULL,      -- TON stake per participant
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Participants in a bot session (user_id = telegram_id)
CREATE TABLE public.participants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,       -- telegram_id
    username TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Penalty deductions within a session (written by both bot and app)
CREATE TABLE public.deductions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    telegram_id TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- TON wallets managed by the bot (service-role access only)
CREATE TABLE public.ton_wallets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telegram_id TEXT NOT NULL UNIQUE,
    ton_address TEXT NOT NULL,
    encrypted_seed TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ─── Row Level Security ───────────────────────────────────────

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ton_wallets ENABLE ROW LEVEL SECURITY;

-- groups
CREATE POLICY "Anyone can view groups" ON public.groups
    FOR SELECT USING (true);

CREATE POLICY "Users can create groups" ON public.groups
    FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update groups" ON public.groups
    FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Creators can delete groups" ON public.groups
    FOR DELETE USING (auth.uid() = creator_id);

-- group_members
CREATE POLICY "Users can view members of their groups" ON public.group_members
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = group_members.group_id AND g.creator_id = auth.uid()
        )
    );

CREATE POLICY "Users can join groups" ON public.group_members
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own membership" ON public.group_members
    FOR UPDATE USING (auth.uid() = user_id);

-- linked_accounts: app reads its own row, app inserts to link
CREATE POLICY "User can read own linked account" ON public.linked_accounts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "User can insert linked account" ON public.linked_accounts
    FOR INSERT TO authenticated WITH CHECK (true);

-- sessions, participants: public read (bot uses service role for writes)
CREATE POLICY "Anyone can view sessions" ON public.sessions
    FOR SELECT USING (true);

CREATE POLICY "Anyone can view participants" ON public.participants
    FOR SELECT USING (true);

-- deductions: app can insert, anyone can read (bot needs realtime SELECT)
CREATE POLICY "Anyone can view deductions" ON public.deductions
    FOR SELECT USING (true);

CREATE POLICY "App can insert deductions" ON public.deductions
    FOR INSERT TO authenticated WITH CHECK (true);

-- ton_wallets: no access for anon or authenticated — service role only
-- (no policies needed; service role bypasses RLS)
CREATE POLICY "Authenticated users can join sessions" ON public.participants
    FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE sessions ADD COLUMN chat_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE deductions ADD COLUMN IF NOT EXISTS app_name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS banned_apps TEXT[] DEFAULT ARRAY[
  'com.zhiliaoapp.musically',
  'com.instagram.android',
  'com.google.android.youtube',
  'com.whatsapp'
];

ALTER TABLE sessions ADD COLUMN penalty_rate numeric DEFAULT 0;