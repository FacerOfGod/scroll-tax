-- pgTAP tests for the custodial treasury money-path RPCs + settlement state machine.
-- Run with:  supabase test db
-- (These cannot run in CI without a Postgres instance; they assert the invariants the
--  treasury edge function relies on: idempotent credit/debit, reserve-before-pay,
--  re-credit on failed payout, and the active→settling claim.)
--
-- NOTE: not yet executed against a live DB — shake out with `supabase test db` before
-- trusting. Fixtures use fixed UUIDs and the service-role RPCs (explicit user_id
-- params, no auth.uid()), so no JWT simulation is needed.

begin;
select plan(16);

-- ─── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@test.dev');

insert into public.groups (id, name, creator_id, stake_type, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Group',
   '11111111-1111-1111-1111-111111111111', 'xrp', 'active');

-- ─── treasury_credit: deposit + idempotency ──────────────────────────────────
select is(
  (public.treasury_credit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 1000000, 'dephash1', 'dep1')->>'balance_drops')::bigint,
  1000000::bigint, 'treasury_credit credits 1,000,000 drops');

select is(
  (public.treasury_credit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 1000000, 'dephash1', 'dep1')->>'already_processed')::boolean,
  true, 'treasury_credit is idempotent on idempotency_key');

select is(
  (select balance_drops from public.treasury_ledger
   where group_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  1000000::bigint, 'duplicate credit did not change the balance');

select is(
  (public.treasury_credit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 500000, 'dephash2', 'dep2')->>'balance_drops')::bigint,
  1500000::bigint, 'a second distinct credit adds to the balance');

-- ─── treasury_debit: reserve + insufficient + idempotency ────────────────────
select is(
  (public.treasury_debit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 400000, 'refund', 'pay1')->>'balance_drops')::bigint,
  1100000::bigint, 'treasury_debit reserves (decrements) the balance');

select throws_ok(
  $$ select public.treasury_debit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       '11111111-1111-1111-1111-111111111111', 99999999, 'refund', 'pay_over') $$,
  'insufficient_treasury_balance',
  'treasury_debit rejects an over-balance reserve');

select is(
  (public.treasury_debit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 400000, 'refund', 'pay1')->>'already_processed')::boolean,
  true, 'treasury_debit is idempotent on idempotency_key');

-- ─── treasury_finalize_payout: confirm (no re-credit) + idempotency ──────────
select is(
  (public.treasury_finalize_payout('pay1', true, 'txhash1')->>'status'),
  'confirmed', 'finalize success marks the payout confirmed');

select is(
  (select balance_drops from public.treasury_ledger
   where group_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  1100000::bigint, 'a confirmed payout does NOT re-credit the reserve');

select is(
  (public.treasury_finalize_payout('pay1', true, 'txhash1')->>'already_final')::boolean,
  true, 'finalize is idempotent once the payout is final');

-- ─── treasury_finalize_payout: failure re-credits the reserve ────────────────
select is(
  (public.treasury_debit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111', 200000, 'refund', 'pay2')->>'balance_drops')::bigint,
  900000::bigint, 'second reserve decrements again');

select is(
  (public.treasury_finalize_payout('pay2', false, null)->>'status'),
  'failed', 'finalize failure marks the payout failed');

select is(
  (select balance_drops from public.treasury_ledger
   where group_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  1100000::bigint, 'a failed payout re-credits the reserved drops');

-- ─── begin_settlement: active → settling, single-claim ───────────────────────
select is(
  (public.begin_settlement('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'acquired')::boolean,
  true, 'begin_settlement claims an active group');

select is(
  (select status from public.groups where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'settling', 'group status flipped to settling');

select is(
  (public.begin_settlement('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')->>'acquired')::boolean,
  false, 'a second begin_settlement does not re-claim (idempotent)');

select * from finish();
rollback;
