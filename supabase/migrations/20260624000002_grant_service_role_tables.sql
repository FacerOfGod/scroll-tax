-- ============================================================
-- Restore service_role table privileges (companion to 20260624000001)
-- ============================================================
-- Fixes "42501 permission denied for table connected_accounts" raised by the
-- connect-account edge function's upsert (and the same latent failure on every
-- other server-only write: oauth_tokens, self_bets, treasury_ledger, …).
--
-- WHY: 20260624000001 documented that migration-created tables did not receive
-- Supabase's implicit default-privilege grants, and fixed that for the
-- `authenticated` role. The identical gap exists for `service_role`: it was
-- never explicitly granted, and the absent default privileges mean it has NO
-- table access — so edge functions using SUPABASE_SERVICE_ROLE_KEY get 42501.
--
-- service_role is the trusted backend identity (it already bypasses RLS), so
-- full DML is exactly the Supabase default and not a security regression. This
-- mirrors the stock `GRANT ALL ... TO service_role` bootstrap and makes the
-- schema self-contained across fresh / reset databases.

GRANT USAGE ON SCHEMA public TO service_role;

-- All current tables + sequences.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Future tables + sequences created by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
