-- ============================================================
-- Explicit table privileges for the authenticated role
-- ============================================================
-- Fixes "42501 permission denied for table ..." (seen on self_bets,
-- group_members, and any other app table on first access).
--
-- WHY: in PostgreSQL an RLS policy and a table privilege are independent gates.
--   * A policy `FOR SELECT TO authenticated USING (...)` decides WHICH ROWS the
--     role may see.
--   * `GRANT SELECT ON <table> TO authenticated` decides whether the role may
--     touch the table AT ALL.
-- A policy with no underlying GRANT raises 42501 "permission denied for table".
-- (A missing *policy* with the grant present would instead return 0 rows.)
-- Supabase normally applies these grants implicitly via default privileges; they
-- were absent for the migration-created tables. Declaring them here makes the
-- schema self-contained and portable across fresh / reset databases.
--
-- Privileges are scoped to each table's RLS intent. Money/stat columns stay
-- write-only-via-RPC: NO INSERT/UPDATE on user_profiles, and on group_members
-- only wallet_address is updatable (see 20260624000000_rls_hardening.sql). The
-- anon role is intentionally granted nothing — every policy is TO authenticated
-- and the app is fully auth-gated.

GRANT USAGE ON SCHEMA public TO authenticated;

-- groups — RLS gates: read = member/creator, write = creator.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;

-- group_members — read (leaderboard) + leave (DELETE → soft-delete trigger).
-- INSERT is server-side via join_group(); UPDATE limited to wallet_address.
GRANT SELECT, DELETE         ON public.group_members TO authenticated;
GRANT UPDATE (wallet_address) ON public.group_members TO authenticated;

-- user_profiles — read own only; all token writes go through SECURITY DEFINER RPCs.
GRANT SELECT ON public.user_profiles TO authenticated;

-- penalty_events — read the audit log for groups you're an active member of.
GRANT SELECT ON public.penalty_events TO authenticated;

-- connected_accounts — read + disconnect your own linked accounts.
GRANT SELECT, DELETE ON public.connected_accounts TO authenticated;

-- self_bets — read your own bets.
GRANT SELECT ON public.self_bets TO authenticated;

-- treasury ledger + audit — read your own balance (+ group read for the leaderboard).
GRANT SELECT ON public.treasury_ledger       TO authenticated;
GRANT SELECT ON public.treasury_transactions TO authenticated;

-- oauth_tokens — intentionally NO grant: secret provider tokens stay server-only.
-- (service_role reaches them through its own policy / the service key.)
