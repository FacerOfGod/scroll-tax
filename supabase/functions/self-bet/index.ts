// self-bet — opens, reports progress on, and settles solo "bet on yourself" wagers.
//
//   action 'create'         : capture the server-side baseline, lock the stake (RPC).
//                             For an XRP stake the response carries the treasury
//                             address + amount so the device can escrow the deposit.
//   action 'confirm_deposit': (JWT) verify the on-chain escrow deposit to the
//                             treasury and mark the bet funded (escrow → held).
//   action 'progress'        : read current metric vs target (no state change).
//   action 'settle'          : if the target is met OR the deadline passed, close the
//                             bet. XRP WIN → on-chain refund from the treasury; XRP
//                             LOSS → the held funds simply stay in the treasury.
//   action 'reconcile'       : [admin] resolve refund payouts left 'settling'.
//
// All metric reads happen here (server-side) so the user can never spoof them. XRP
// stakes are escrowed in the omnibus treasury (Gate 0C) so settlement is server-
// authoritative — the device never sends a forfeit. Token stake math is atomic in
// the open_self_bet / settle_self_bet RPCs. Amounts are integer DROPS.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Imported via npm: (not esm.sh). esm.sh regenerates type declarations and ships a
// broken @noble/hashes@1.8.0 dts (hmac.d.ts → "utils.ts.d.ts") that a transitively
// fetched module still pulls in, failing the Deno module graph at boot. npm: uses
// xrpl's own bundled types and resolves cleanly.
import { Wallet, multisign, isValidClassicAddress, xrpToDrops } from 'npm:xrpl@4.6.0'
import {
  Provider,
  Metric,
  METRIC_FOR,
  measureMetric,
  refreshStravaToken,
} from '../_shared/providers.ts'

// ─── Treasury config (shared with the `treasury` edge function) ──────────────
// XRP self-bet stakes are escrowed in the same omnibus treasury account that holds
// group stakes. The treasury key signs refund payouts offline.
const XRPL_HTTP = Deno.env.get('XRPL_RPC_URL') ?? 'https://s.altnet.rippletest.net:51234'
const TREASURY_ADDRESS = Deno.env.get('TREASURY_ADDRESS') ?? ''
const TREASURY_SEED = Deno.env.get('TREASURY_SEED') ?? ''
const ADMIN_SECRET = Deno.env.get('TREASURY_ADMIN_SECRET') ?? ''
const SIGNER_SEEDS = (Deno.env.get('TREASURY_SIGNER_SEEDS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)
// Mainnet safety switches — see treasury/index.ts and .env.example. Off by default.
const REQUIRE_MULTISIG = (Deno.env.get('TREASURY_REQUIRE_MULTISIG') ?? '') === 'true'
const REQUIRE_FULL_HISTORY = (Deno.env.get('TREASURY_REQUIRE_FULL_HISTORY') ?? '') === 'true'
const HISTORY_FLOOR_LEDGER = Number(Deno.env.get('TREASURY_HISTORY_FLOOR_LEDGER') ?? '32570')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Treasury-Admin',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// ─── XRPL helpers (kept in sync with functions/treasury/index.ts) ────────────
// Edge functions are self-contained by convention, so the treasury signing core is
// mirrored here rather than shared. The group-treasury path is untouched.
const isValidDrops = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0

const isValidTxHash = (h: unknown): h is string =>
  typeof h === 'string' && /^[0-9A-Fa-f]{64}$/.test(h)

// Convert a NUMERIC XRP stake to integer drops, rejecting (>6 dp / overflow) inputs.
function xrpStakeToDrops(amount: number): number | null {
  try {
    const d = Number(xrpToDrops(String(amount)))
    return isValidDrops(d) ? d : null
  } catch { return null }
}

async function rpc(method: string, params: Record<string, unknown>) {
  const resp = await fetch(XRPL_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  })
  return (await resp.json())?.result
}

async function lookupTx(hash: string) {
  return rpc('tx', { transaction: hash, binary: false })
}

function isFullHistory(completeLedgers: unknown, floor: number): boolean {
  if (typeof completeLedgers !== 'string' || completeLedgers === 'empty') return false
  const ranges = completeLedgers.split(',').map(s => s.trim()).filter(Boolean)
  if (ranges.length !== 1) return false
  const start = Number(ranges[0].split('-')[0])
  return Number.isFinite(start) && start <= floor
}

// lsfDisableMaster — the account's master key pair is disabled (XRPL account flag).
const LSF_DISABLE_MASTER = 0x00100000

// Mainnet custody invariant: refuse to sign unless the treasury is multisig with its
// master key disabled and a SignerList installed. No-op on testnet (flag unset).
function assertCustodySafe(acctData: any, useMultisign: boolean): void {
  if (!REQUIRE_MULTISIG) return
  if (!useMultisign) throw new Error('custody_single_key_forbidden')
  const flags = Number(acctData?.Flags ?? 0)
  // eslint-disable-next-line no-bitwise -- bitmask is the correct test for an XRPL account flag
  if ((flags & LSF_DISABLE_MASTER) === 0) throw new Error('custody_master_key_enabled')
  const signerLists = acctData?.signer_lists
  if (!Array.isArray(signerLists) || signerLists.length === 0) {
    throw new Error('custody_no_signer_list')
  }
}

// Sign + submit a refund from the treasury to the bet owner. Multisigns when
// TREASURY_SIGNER_SEEDS is set, else single-signs with TREASURY_SEED.
async function sendFromTreasury(destination: string, amountDrops: string) {
  const useMultisign = SIGNER_SEEDS.length > 0

  const acct = await rpc('account_info', {
    account: TREASURY_ADDRESS, ledger_index: 'current', signer_lists: true,
  })
  const sequence = acct?.account_data?.Sequence
  if (sequence === undefined) throw new Error('treasury_account_not_found')
  assertCustodySafe(acct?.account_data, useMultisign)

  const ledger = await rpc('ledger_current', {})
  const currentLedger = ledger?.ledger_current_index ?? 0

  const baseFee = 12
  const tx = {
    TransactionType: 'Payment',
    Account: TREASURY_ADDRESS,
    Destination: destination,
    Amount: amountDrops,
    Fee: String(useMultisign ? baseFee * (SIGNER_SEEDS.length + 1) : baseFee),
    Sequence: sequence,
    LastLedgerSequence: currentLedger + 20,
  }

  let tx_blob: string
  if (useMultisign) {
    const blobs = SIGNER_SEEDS.map(s => Wallet.fromSeed(s).sign(tx as never, true).tx_blob)
    tx_blob = multisign(blobs)
  } else {
    tx_blob = Wallet.fromSeed(TREASURY_SEED).sign(tx as never).tx_blob
  }

  const submit = await rpc('submit', { tx_blob })
  const hash = submit?.tx_json?.hash as string | undefined
  const engine = submit?.engine_result as string | undefined
  if (!hash) return { hash: '', validated: false, result: engine }

  for (let i = 0; i < 5; i++) {
    try {
      const looked = await lookupTx(hash)
      if (looked?.validated === true) {
        return { hash, validated: true, result: looked?.meta?.TransactionResult as string }
      }
    } catch { /* transient — leave for reconciliation */ }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { hash, validated: false, result: engine }
}

const isDefinitiveFailure = (code?: string) =>
  !!code && /^(tef|tem|tel|tec)/.test(code) && code !== 'tesSUCCESS'

// Refund a WON XRP bet's escrow on-chain to the user. Reserve (held → settling),
// sign+submit, finalize. Resume-safe: only ever called for a freshly-'held' bet, so
// it never double-sends. Ambiguous outcomes stay 'settling' for the reconcile job.
async function doRefund(admin: SupabaseClient, betId: string) {
  const { data: begin, error: beginErr } = await admin.rpc('self_bet_begin_refund', { p_bet_id: betId })
  if (beginErr) return { ok: false, error: beginErr.message }
  if (!begin?.ok) return { ok: false, error: begin?.error ?? 'begin_refund_failed' }
  if (begin.already_final) return { ok: true, already_final: true, escrow_status: begin.escrow_status }
  // Another call already reserved this refund (concurrent settle) — do NOT send a
  // second payout; leave the in-flight one to the reconcile job.
  if (!begin.reserved) return { ok: true, pending: true }

  const dest = begin.wallet as string
  const drops = Number(begin.escrow_drops)
  if (!dest || !isValidClassicAddress(dest) || !isValidDrops(drops)) {
    await admin.rpc('self_bet_finalize_refund', { p_bet_id: betId, p_success: false, p_tx_hash: null })
    return { ok: false, error: 'bad_refund_target' }
  }

  let outcome: { hash: string; validated: boolean; result?: string }
  try {
    outcome = await sendFromTreasury(dest, String(drops))
  } catch (e) {
    // Ambiguous (the tx may be in flight): leave the bet 'settling' so reconcile can
    // resolve it from the ledger, rather than reverting and risking a double-send.
    return { ok: false, pending: true, error: `refund_submit_failed: ${(e as Error).message}` }
  }

  const succeeded = outcome.validated && outcome.result === 'tesSUCCESS'
  if (succeeded || isDefinitiveFailure(outcome.result)) {
    await admin.rpc('self_bet_finalize_refund', {
      p_bet_id: betId, p_success: succeeded, p_tx_hash: succeeded ? outcome.hash : null,
    })
    return { ok: succeeded, tx_hash: outcome.hash, result: outcome.result }
  }
  if (outcome.hash) {
    await admin.rpc('self_bet_set_pending_hash', { p_bet_id: betId, p_tx_hash: outcome.hash })
  }
  return { ok: true, pending: true, tx_hash: outcome.hash }
}

// Resolve the username / valid access token needed to measure a provider.
// For Strava it transparently refreshes an expired token and persists the new one.
async function measureCtxFor(
  admin: SupabaseClient, userId: string, provider: Provider, sinceISO: string,
) {
  const { data: acct } = await admin
    .from('connected_accounts')
    .select('external_username')
    .eq('user_id', userId).eq('provider', provider).maybeSingle()

  const ctx: { username: string | null; accessToken: string | null; sinceISO: string } = {
    username: acct?.external_username ?? null,
    accessToken: null,
    sinceISO,
  }

  if (provider === 'github' || provider === 'strava') {
    const { data: tok } = await admin
      .from('oauth_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId).eq('provider', provider).maybeSingle()
    if (!tok) throw new Error(`${provider}_not_connected`)

    let accessToken = tok.access_token as string
    if (provider === 'strava' && tok.expires_at &&
        new Date(tok.expires_at).getTime() < Date.now() + 60_000) {
      const fresh = await refreshStravaToken(
        Deno.env.get('STRAVA_CLIENT_ID')!,
        Deno.env.get('STRAVA_CLIENT_SECRET')!,
        tok.refresh_token as string,
      )
      accessToken = fresh.access_token
      await admin.from('oauth_tokens').update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token,
        expires_at: new Date(fresh.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('provider', 'strava')
    }
    ctx.accessToken = accessToken
  }

  return ctx
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const action = body.action as string

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ─── reconcile (admin only) ────────────────────────────────────────────────
  // Resolve XRP refund payouts left 'settling' (submitted but not confirmed within
  // the poll window). Cron-invoked, same shape as the treasury reconcile.
  if (action === 'reconcile') {
    if (!ADMIN_SECRET || req.headers.get('X-Treasury-Admin') !== ADMIN_SECRET) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }
    if (REQUIRE_FULL_HISTORY) {
      let completeLedgers: unknown
      try {
        completeLedgers = (await rpc('server_info', {}))?.info?.complete_ledgers
      } catch {
        return json({ ok: false, error: 'reconcile_node_check_failed' }, 503)
      }
      if (!isFullHistory(completeLedgers, HISTORY_FLOOR_LEDGER)) {
        return json(
          { ok: false, error: 'reconcile_node_not_full_history', complete_ledgers: completeLedgers },
          503,
        )
      }
    }
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: stuck } = await admin
      .from('self_bets')
      .select('id, payout_tx_hash')
      .eq('escrow_status', 'settling')
      .lt('settled_at', cutoff)
      .limit(100)

    const results: any[] = []
    for (const row of stuck ?? []) {
      // No hash captured → the refund never submitted → revert to held for retry.
      if (!row.payout_tx_hash) {
        const { data: fin } = await admin.rpc('self_bet_finalize_refund', {
          p_bet_id: row.id, p_success: false, p_tx_hash: null,
        })
        results.push({ id: row.id, success: false, escrow_status: (fin as any)?.escrow_status })
        continue
      }
      let tx: any
      try {
        tx = await lookupTx(row.payout_tx_hash)
      } catch {
        results.push({ id: row.id, skipped: 'lookup_error' })
        continue
      }
      const success = tx?.validated === true && tx?.meta?.TransactionResult === 'tesSUCCESS'
      const { data: fin } = await admin.rpc('self_bet_finalize_refund', {
        p_bet_id: row.id, p_success: success, p_tx_hash: success ? row.payout_tx_hash : null,
      })
      results.push({ id: row.id, success, escrow_status: (fin as any)?.escrow_status })
    }
    return json({ ok: true, reconciled: results.length, results })
  }

  // ─── user actions require a valid Supabase JWT ─────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return json({ ok: false, error: 'unauthenticated' }, 401)

  try {
    // ─── create ──────────────────────────────────────────────────────────────
    if (action === 'create') {
      const provider = body.provider as Provider
      if (!['github', 'strava', 'chesscom', 'leetcode'].includes(provider)) {
        return json({ ok: false, error: 'invalid_provider' }, 400)
      }
      const target = Number(body.target)
      const stakeAmount = Number(body.stake_amount)
      const stakeType = (body.stake_type === 'xrp' ? 'xrp' : 'tokens') as 'xrp' | 'tokens'
      const periodDays = Number(body.period_days)
      const wallet = body.wallet_address ?? null
      if (!(target > 0) || !(stakeAmount > 0) || !(periodDays > 0)) {
        return json({ ok: false, error: 'invalid_params' }, 400)
      }

      // XRP stakes are escrowed in the treasury → require a configured treasury and a
      // valid owner wallet, and a stake that converts cleanly to drops.
      let amountDrops = 0
      if (stakeType === 'xrp') {
        if (!TREASURY_ADDRESS) return json({ ok: false, error: 'treasury_not_configured' }, 500)
        if (!wallet || !isValidClassicAddress(wallet)) {
          return json({ ok: false, error: 'invalid_wallet' }, 400)
        }
        const d = xrpStakeToDrops(stakeAmount)
        if (d === null) return json({ ok: false, error: 'invalid_stake' }, 400)
        amountDrops = d
      }

      const periodStart = new Date()
      const periodEnd = new Date(periodStart.getTime() + periodDays * 86_400_000)

      // Baseline is measured from period_start so github/strava in-window counts start at ~0.
      const ctx = await measureCtxFor(admin, user.id, provider, periodStart.toISOString())
      const baseline = await measureMetric(provider, ctx)

      const { data: rpcRes, error: rpcErr } = await admin.rpc('open_self_bet', {
        p_user_id: user.id,
        p_provider: provider,
        p_metric: METRIC_FOR[provider] as Metric,
        p_target: target,
        p_period_end: periodEnd.toISOString(),
        p_baseline: baseline,
        p_stake_amount: stakeAmount,
        p_stake_type: stakeType,
        p_wallet: wallet,
      })
      if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500)

      const out: any = { ...(rpcRes as object) }
      // For an XRP bet the device must now escrow the stake into the treasury.
      if (stakeType === 'xrp' && (rpcRes as any)?.ok) {
        out.needs_deposit = true
        out.treasury_address = TREASURY_ADDRESS
        out.amount_drops = amountDrops
      }
      return json(out)
    }

    // ─── confirm_deposit ───────────────────────────────────────────────────────
    // Verify the on-chain escrow deposit to the treasury, then mark the bet funded.
    if (action === 'confirm_deposit') {
      const { bet_id, tx_hash } = body
      if (!bet_id || !isValidTxHash(tx_hash)) return json({ ok: false, error: 'invalid_params' }, 400)

      const { data: bet } = await admin
        .from('self_bets').select('*').eq('id', bet_id).maybeSingle()
      if (!bet) return json({ ok: false, error: 'bet_not_found' }, 404)
      if (bet.user_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403)
      if (bet.stake_type !== 'xrp') return json({ ok: false, error: 'not_xrp' }, 400)

      const requiredDrops = xrpStakeToDrops(Number(bet.stake_amount))
      if (requiredDrops === null) return json({ ok: false, error: 'bad_stake' }, 400)

      const tx = await lookupTx(tx_hash)
      const ok =
        tx?.validated === true &&
        tx?.meta?.TransactionResult === 'tesSUCCESS' &&
        tx?.TransactionType === 'Payment' &&
        tx?.Destination === TREASURY_ADDRESS &&
        (!bet.wallet_address || tx?.Account === bet.wallet_address)
      if (!ok) return json({ ok: false, error: 'deposit_not_verified' }, 400)

      const delivered = tx?.meta?.delivered_amount ?? tx?.Amount
      const deliveredDrops = Number(delivered)
      if (!Number.isInteger(deliveredDrops) || deliveredDrops < requiredDrops) {
        return json({ ok: false, error: 'insufficient_deposit' }, 400)
      }

      const { data: credit, error: credErr } = await admin.rpc('self_bet_confirm_deposit', {
        p_bet_id: bet_id, p_user_id: user.id, p_amount_drops: requiredDrops, p_tx_hash: tx_hash,
      })
      if (credErr) return json({ ok: false, error: credErr.message }, 500)
      return json({ ok: true, ...(credit as object) })
    }

    // ─── progress / settle share the bet lookup + measurement ─────────────────
    if (action === 'progress' || action === 'settle') {
      const betId = body.bet_id as string
      if (!betId) return json({ ok: false, error: 'bet_id_required' }, 400)

      const { data: bet } = await admin
        .from('self_bets').select('*').eq('id', betId).maybeSingle()
      if (!bet) return json({ ok: false, error: 'bet_not_found' }, 404)
      if (bet.user_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403)

      // Already-settled bets just echo their stored outcome — except a WON XRP bet
      // still 'held' (refund not completed) is resumed here on a settle call.
      if (bet.status !== 'active') {
        if (action === 'settle' && bet.stake_type === 'xrp' &&
            bet.status === 'won' && bet.escrow_status === 'held') {
          const refund = await doRefund(admin, betId)
          return json({ ok: true, settled: true, status: 'won', stake_type: 'xrp', refund })
        }
        return json({
          ok: true, settled: true, status: bet.status,
          current: bet.final_value, baseline: bet.baseline,
          progress: (bet.final_value ?? bet.baseline) - bet.baseline,
          target: bet.target_count, escrow_status: bet.escrow_status,
        })
      }

      // An XRP bet can only settle once its escrow deposit is funded.
      if (action === 'settle' && bet.stake_type === 'xrp' && bet.escrow_status !== 'held') {
        return json({
          ok: true, settled: false, status: 'active', awaiting_deposit: true,
          treasury_address: TREASURY_ADDRESS,
          amount_drops: xrpStakeToDrops(Number(bet.stake_amount)) ?? 0,
        })
      }

      const ctx = await measureCtxFor(admin, user.id, bet.provider as Provider, bet.period_start)
      const current = await measureMetric(bet.provider as Provider, ctx)
      const progress = current - bet.baseline
      const deadlinePassed = new Date(bet.period_end).getTime() <= Date.now()
      const targetMet = progress >= bet.target_count

      const base = {
        current, baseline: bet.baseline, progress,
        target: bet.target_count, period_end: bet.period_end,
      }

      if (action === 'progress' || (!targetMet && !deadlinePassed)) {
        return json({ ok: true, settled: false, status: 'active', ...base })
      }

      // settle: target met (win) or deadline passed without meeting it (loss)
      const { data: rpcRes, error: rpcErr } = await admin.rpc('settle_self_bet', {
        p_bet_id: betId,
        p_final_value: current,
      })
      if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500)

      const result: any = { ok: true, settled: true, ...(rpcRes as object), ...base }
      // XRP WIN → refund the escrow on-chain from the treasury. XRP LOSS → the held
      // funds already stay in the treasury (settle_self_bet marked it 'forfeited');
      // the device never sends anything.
      if ((rpcRes as any)?.status === 'won' &&
          (rpcRes as any)?.stake_type === 'xrp' &&
          (rpcRes as any)?.escrow_status === 'held') {
        result.refund = await doRefund(admin, betId)
      }
      return json(result)
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('self-bet error:', e)
    return json({ ok: false, error: String((e as Error)?.message ?? 'self_bet_failed') }, 502)
  }
})
