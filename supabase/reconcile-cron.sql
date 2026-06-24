-- ============================================================
-- Schedule the treasury reconcile job (operator runbook — run manually)
-- ============================================================
-- This is NOT in migrations/ on purpose: it depends on project-specific values
-- (function URL, admin secret) and the pg_cron / pg_net extensions, so it should
-- be applied deliberately per environment rather than on every `db push`.
--
-- It periodically POSTs { action: 'reconcile' } to the `treasury` edge function,
-- which resolves payouts left 'pending' (confirm on-chain success, else
-- re-credit). The admin secret is read from Supabase Vault so it never lives in
-- the repo or in the cron.job table in plaintext.
--
-- Prerequisites (run once, as the project owner):
--   1. Deploy the `treasury` edge function and set its secrets, including
--      TREASURY_ADMIN_SECRET (and a FULL-HISTORY XRPL_RPC_URL for production).
--   2. Enable the extensions and store the two values in Vault:

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the function URL and the admin secret in Vault (replace the values):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/treasury',
--                              'treasury_function_url');
--   select vault.create_secret('<YOUR_TREASURY_ADMIN_SECRET>', 'treasury_admin_secret');

-- 3. Schedule reconciliation every 10 minutes. The command reads both secrets
--    from Vault at run time, so rotating them needs no change here.
select cron.schedule(
  'treasury-reconcile',
  '*/10 * * * *',
  $$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'treasury_function_url'),
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'X-Treasury-Admin', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'treasury_admin_secret')
      ),
      body    := jsonb_build_object('action', 'reconcile')
    );
  $$
);

-- ── Self-bet refund reconcile ───────────────────────────────────────────────
-- XRP self-bet WIN refunds are paid from the same treasury and can likewise be left
-- 'settling' (submitted but unconfirmed). The `self-bet` edge function exposes the
-- same admin `reconcile` action (same TREASURY_ADMIN_SECRET, same full-history rule)
-- over self_bets. Schedule it too. Store its URL in Vault first (replace the value):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/self-bet',
--                              'self_bet_function_url');
select cron.schedule(
  'self-bet-reconcile',
  '*/10 * * * *',
  $$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'self_bet_function_url'),
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'X-Treasury-Admin', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'treasury_admin_secret')
      ),
      body    := jsonb_build_object('action', 'reconcile')
    );
  $$
);

-- To inspect or remove the schedules later:
--   select * from cron.job where jobname in ('treasury-reconcile', 'self-bet-reconcile');
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('treasury-reconcile');
--   select cron.unschedule('self-bet-reconcile');
