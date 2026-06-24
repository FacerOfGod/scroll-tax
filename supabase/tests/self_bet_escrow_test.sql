-- pgTAP tests for the XRP self-bet escrow money-path RPCs (Gate 0C).
-- Run with:  supabase test db
--
-- Asserts the invariants the self-bet edge function relies on: deposit pending→held
-- (idempotent, owner-checked), settle marks an XRP loss 'forfeited' atomically, the
-- WIN refund reserve is race-safe (single 'reserved'), finalize refunds/reverts, and
-- the token path still deducts/credits. Service-role RPCs use explicit user_id params
-- (no auth.uid()), so no JWT simulation is needed.
--
-- NOTE: not yet executed against a live DB — shake out with `supabase test db`.

begin;
select plan(19);

-- ─── fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@test.dev');

insert into public.user_profiles (user_id, tokens) values
  ('11111111-1111-1111-1111-111111111111', 100);

-- b1 = awaiting deposit, b2 = funded (settles to a WIN), b3 = funded (settles to a LOSS)
insert into public.self_bets
  (id, user_id, provider, metric, target_count, baseline, period_end,
   stake_amount, stake_type, wallet_address, escrow_status, escrow_drops, status)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '11111111-1111-1111-1111-111111111111',
   'github', 'commits', 5, 0, now() + interval '7 days', 1, 'xrp', 'rWalletTest1', 'pending', 0, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '11111111-1111-1111-1111-111111111111',
   'github', 'commits', 5, 0, now() + interval '7 days', 1, 'xrp', 'rWalletTest2', 'held', 1000000, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '11111111-1111-1111-1111-111111111111',
   'github', 'commits', 5, 0, now() + interval '7 days', 1, 'xrp', 'rWalletTest3', 'held', 1000000, 'active');

-- ─── confirm_deposit: pending → held, idempotent, owner-checked ──────────────
select is(
  (public.self_bet_confirm_deposit('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
     '11111111-1111-1111-1111-111111111111', 1000000, 'deposithash1')->>'escrow_status'),
  'held', 'confirm_deposit moves a pending XRP bet to held');

select is(
  (select escrow_drops from public.self_bets where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
  1000000::bigint, 'confirm_deposit records the escrowed drops');

select is(
  (public.self_bet_confirm_deposit('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
     '11111111-1111-1111-1111-111111111111', 1000000, 'deposithash1')->>'already_processed')::boolean,
  true, 'confirm_deposit is idempotent on the deposit tx hash');

select is(
  (public.self_bet_confirm_deposit('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
     '99999999-9999-9999-9999-999999999999', 1000000, 'deposithash2')->>'error'),
  'forbidden', 'confirm_deposit rejects a non-owner');

-- ─── settle: XRP LOSS forfeits in-treasury (no on-chain) ─────────────────────
select is(
  (public.settle_self_bet('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 0)->>'status'),
  'lost', 'an XRP bet under target settles to lost');

select is(
  (select escrow_status from public.self_bets where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3'),
  'forfeited', 'a lost XRP bet forfeits the held escrow to the treasury');

-- ─── settle: XRP WIN keeps escrow held for the refund ────────────────────────
select is(
  (public.settle_self_bet('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 10)->>'status'),
  'won', 'an XRP bet over target settles to won');

select is(
  (select escrow_status from public.self_bets where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'),
  'held', 'a won XRP bet keeps the escrow held for the on-chain refund');

-- ─── begin_refund: held → settling, single reservation (race-safe) ───────────
select is(
  (public.self_bet_begin_refund('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2')->>'reserved')::boolean,
  true, 'begin_refund reserves the refund (reserved=true) for the first caller');

select is(
  (select escrow_status from public.self_bets where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'),
  'settling', 'begin_refund flips the escrow to settling');

select is(
  (public.self_bet_begin_refund('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2')->>'reserved')::boolean,
  false, 'a concurrent begin_refund does NOT re-reserve (no double-send)');

-- ─── finalize_refund: success → refunded, idempotent ─────────────────────────
select is(
  (public.self_bet_finalize_refund('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', true, 'refundtx1')->>'escrow_status'),
  'refunded', 'finalize_refund success marks the escrow refunded');

select is(
  (select payout_tx_hash from public.self_bets where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'),
  'refundtx1', 'finalize_refund stamps the on-chain refund tx hash');

select is(
  (public.self_bet_finalize_refund('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', true, 'refundtx1')->>'already_final')::boolean,
  true, 'finalize_refund is idempotent once refunded');

-- ─── begin_refund refuses a lost bet ─────────────────────────────────────────
select is(
  (public.self_bet_begin_refund('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')->>'error'),
  'not_won', 'begin_refund refuses a lost bet (nothing to refund)');

-- ─── open_self_bet: XRP starts pending; token path deducts/credits ───────────
create temp table _xrp as
  select (public.open_self_bet('11111111-1111-1111-1111-111111111111',
            'github', 'commits', 5, now() + interval '7 days', 0, 1, 'xrp', 'rWalletX')->>'bet_id')::uuid as id;
select is(
  (select escrow_status from public.self_bets where id = (select id from _xrp)),
  'pending', 'open_self_bet starts an XRP bet in escrow pending');

create temp table _tok as
  select (public.open_self_bet('11111111-1111-1111-1111-111111111111',
            'github', 'commits', 5, now() + interval '7 days', 0, 20, 'tokens', null)->>'bet_id')::uuid as id;
select is(
  (select tokens from public.user_profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  80::numeric, 'opening a token bet deducts the stake');

select is(
  (public.settle_self_bet((select id from _tok), 10)->>'status'),
  'won', 'a token bet over target settles to won');

select is(
  (select tokens from public.user_profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  100::numeric, 'a won token bet credits the stake back');

select * from finish();
rollback;
