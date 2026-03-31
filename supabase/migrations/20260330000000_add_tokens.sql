-- ─── user_profiles: stores in-app token balance ─────────────────────────────
CREATE TABLE public.user_profiles (
  user_id    UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tokens     NUMERIC NOT NULL DEFAULT 100 CHECK (tokens >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Allow service role full access (for server-side penalty redistribution)
CREATE POLICY "Service role full access" ON public.user_profiles
  FOR ALL TO service_role USING (true);

-- ─── Add stake_type to groups ─────────────────────────────────────────────────
ALTER TABLE public.groups
  ADD COLUMN stake_type TEXT NOT NULL DEFAULT 'xrp'
    CHECK (stake_type IN ('xrp', 'tokens'));
