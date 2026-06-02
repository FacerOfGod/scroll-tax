-- ============================================================
-- "Bet on yourself" — connected accounts + solo self-wagers
-- ============================================================
-- A user pledges a stake on their own productivity goal (GitHub
-- commits, Strava runs, Chess.com wins, LeetCode solves) and wins
-- the stake back or forfeits it. All metric verification happens
-- server-side in edge functions (see supabase/functions/self-bet).

-- ─── connected_accounts: which external profiles a user has linked ──────────
-- One row per (user, provider). Non-secret display data only.
-- Rows are written by the connect-account edge function (service role) AFTER
-- it validates the username / completes the OAuth exchange.

CREATE TABLE public.connected_accounts (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL
                      CHECK (provider IN ('github', 'strava', 'chesscom', 'leetcode')),
  external_username TEXT,
  connected_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE (user_id, provider)
);

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

-- Users can see and disconnect their own linked accounts.
CREATE POLICY "Users can read own connected accounts" ON public.connected_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own connected accounts" ON public.connected_accounts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- No INSERT/UPDATE policy for authenticated — only the edge function (service
-- role) writes rows, after server-side validation of the username / OAuth code.
CREATE POLICY "Service role full access connected accounts" ON public.connected_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── oauth_tokens: secret provider tokens, kept off the device ──────────────
-- GitHub / Strava only. RLS grants the authenticated role NOTHING, so tokens
-- never reach the client. Only service_role (edge functions) can read/write.

CREATE TABLE public.oauth_tokens (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('github', 'strava')),
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMP WITH TIME ZONE,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policy for the authenticated role → all client reads denied.
CREATE POLICY "Service role full access oauth tokens" ON public.oauth_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── self_bets: the solo wager ──────────────────────────────────────────────

CREATE TABLE public.self_bets (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL
                   CHECK (provider IN ('github', 'strava', 'chesscom', 'leetcode')),
  metric         TEXT NOT NULL
                   CHECK (metric IN ('commits', 'runs', 'wins', 'solves')),
  target_count   NUMERIC NOT NULL CHECK (target_count > 0),
  baseline       NUMERIC NOT NULL DEFAULT 0 CHECK (baseline >= 0),
  period_start   TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  period_end     TIMESTAMP WITH TIME ZONE NOT NULL,
  stake_amount   NUMERIC NOT NULL CHECK (stake_amount > 0),
  stake_type     TEXT NOT NULL DEFAULT 'tokens' CHECK (stake_type IN ('xrp', 'tokens')),
  wallet_address TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'won', 'lost')),
  final_value    NUMERIC,
  settled_at     TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.self_bets ENABLE ROW LEVEL SECURITY;

-- Users can read their own bets (for the dashboard list / progress UI).
CREATE POLICY "Users can read own self bets" ON public.self_bets
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- No client INSERT/UPDATE — bets are opened/settled through the SECURITY DEFINER
-- RPCs (open_self_bet / settle_self_bet) so the token ledger stays authoritative.
CREATE POLICY "Service role full access self bets" ON public.self_bets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
