// treasury — custodial (omnibus) treasury operations for group stakes.
//
//   confirm_deposit : (JWT) verify a user's on-chain deposit to the treasury and
//                     credit their internal ledger balance.            [user]
//   balance         : (JWT) read the caller's held balance for a group. [user]
//   payout          : reserve + sign + submit an on-chain payout from the
//                     treasury, then finalize the ledger.        [admin secret]
//
// All XRP amounts are integer DROPS. The treasury key (TREASURY_SEED) lives only
// in function secrets and signs payouts offline; on-chain reads/submits go over
// the XRPL JSON-RPC HTTP endpoint (same transport as verify-penalty-tx). In
// production the treasury account should use a multisig SignerList with the
// signer keys held in a KMS — this single-key form is the testnet slice.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Wallet, multisign } from 'https://esm.sh/xrpl@4.6.0'

const XRPL_HTTP = Deno.env.get('XRPL_RPC_URL') ?? 'https://s.altnet.rippletest.net:51234'
const TREASURY_ADDRESS = Deno.env.get('TREASURY_ADDRESS') ?? ''
const TREASURY_SEED = Deno.env.get('TREASURY_SEED') ?? ''
const ADMIN_SECRET = Deno.env.get('TREASURY_ADMIN_SECRET') ?? ''

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

// ─── XRPL JSON-RPC helpers ───────────────────────────────────────────────────
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

// Submit a treasury payout from the omnibus account. If TREASURY_SIGNER_SEEDS is
// set (comma-separated, >= quorum), the payout is MULTISIGNED by those signer
// keys; otherwise it is single-signed with TREASURY_SEED. Reserves are taken
// before this runs, so the caller finalizes the ledger based on the outcome.
const SIGNER_SEEDS = (Deno.env.get('TREASURY_SIGNER_SEEDS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

async function sendFromTreasury(destination: string, amountDrops: string) {
  const useMultisign = SIGNER_SEEDS.length > 0

  const acct = await rpc('account_info', { account: TREASURY_ADDRESS, ledger_index: 'current' })
  const sequence = acct?.account_data?.Sequence
  if (sequence === undefined) throw new Error('treasury_account_not_found')

  const ledger = await rpc('ledger_current', {})
  const currentLedger = ledger?.ledger_current_index ?? 0

  const baseFee = 12
  const tx = {
    TransactionType: 'Payment',
    Account: TREASURY_ADDRESS,
    Destination: destination,
    Amount: amountDrops,
    // Multisign fees scale with the number of signatures.
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

  // Poll for validation a few times; the tx is final once validated. Lookups are
  // wrapped so a transient RPC error never THROWS after a successful submit — that
  // would risk a wrong re-credit while the tx is actually in flight. Anything
  // unresolved here is left pending for the reconcile job.
  for (let i = 0; i < 5; i++) {
    try {
      const looked = await lookupTx(hash)
      if (looked?.validated === true) {
        return { hash, validated: true, result: looked?.meta?.TransactionResult as string }
      }
    } catch (_) { /* transient — leave for reconciliation */ }
    await new Promise(r => setTimeout(r, 1500))
  }
  // Not yet validated — report the preliminary engine result so the caller can
  // decide to leave the payout pending (a definitive tef/tem/tec means failed).
  return { hash, validated: false, result: engine }
}

const isDefinitiveFailure = (code?: string) =>
  !!code && /^(tef|tem|tel|tec)/.test(code) && code !== 'tesSUCCESS'

// Reserve → sign+submit → finalize one payout. Idempotent on idempotency_key, so
// retries never double-pay. Shared by the `payout` and `settle_group` actions.
async function doPayout(
  admin: ReturnType<typeof createClient>,
  p: { group_id: string; user_id: string; destination: string;
       amount_drops: number; kind: string; idempotency_key: string },
) {
  const { data: reserve, error: resErr } = await admin.rpc('treasury_debit', {
    p_group_id: p.group_id, p_user_id: p.user_id, p_amount_drops: p.amount_drops,
    p_kind: p.kind, p_idempotency_key: p.idempotency_key,
  })
  if (resErr) {
    const insufficient = resErr.message?.includes('insufficient_treasury_balance')
    return { ok: false, error: insufficient ? 'insufficient_balance' : resErr.message }
  }
  if (reserve?.already_processed) return { ok: true, already_processed: true }

  let outcome: { hash: string; validated: boolean; result?: string }
  try {
    outcome = await sendFromTreasury(p.destination, String(p.amount_drops))
  } catch (e) {
    await admin.rpc('treasury_finalize_payout', {
      p_idempotency_key: p.idempotency_key, p_success: false, p_tx_hash: null,
    })
    return { ok: false, error: `payout_submit_failed: ${(e as Error).message}` }
  }

  const succeeded = outcome.validated && outcome.result === 'tesSUCCESS'
  if (succeeded || isDefinitiveFailure(outcome.result)) {
    await admin.rpc('treasury_finalize_payout', {
      p_idempotency_key: p.idempotency_key,
      p_success: succeeded,
      p_tx_hash: succeeded ? outcome.hash : null,
    })
    return { ok: succeeded, tx_hash: outcome.hash, result: outcome.result }
  }
  // ambiguous (queued / not yet validated): persist the hash so the reconcile
  // job can look it up and finalize later, then leave the row pending.
  if (outcome.hash) {
    await admin.rpc('treasury_set_pending_hash', {
      p_idempotency_key: p.idempotency_key, p_tx_hash: outcome.hash,
    })
  }
  return { ok: true, pending: true, tx_hash: outcome.hash }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  if (!TREASURY_ADDRESS) return json({ ok: false, error: 'treasury_not_configured' }, 500)

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

  // ─── payout (admin only) ───────────────────────────────────────────────────
  // Privileged server operation (penalty redistribution / group-end). Gated by a
  // shared secret, never callable by app clients.
  if (action === 'payout') {
    if (!ADMIN_SECRET || req.headers.get('X-Treasury-Admin') !== ADMIN_SECRET) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }
    if (!TREASURY_SEED && SIGNER_SEEDS.length === 0) {
      return json({ ok: false, error: 'treasury_key_missing' }, 500)
    }

    const { group_id, user_id, destination, amount_drops, kind, idempotency_key } = body
    if (!group_id || !user_id || !destination || !idempotency_key ||
        !Number.isInteger(amount_drops) || amount_drops <= 0) {
      return json({ ok: false, error: 'invalid_params' }, 400)
    }

    const r = await doPayout(admin, {
      group_id, user_id, destination, amount_drops, kind, idempotency_key,
    })
    return json(r, r.ok ? 200 : 400)
  }

  // ─── reconcile (admin only) ────────────────────────────────────────────────
  // Resolves payouts left 'pending' (submitted but not confirmed within the poll
  // window). Intended to run on a schedule (e.g. a Supabase cron-invoked call).
  // Only rows older than the grace window are touched — by then the tx's
  // LastLedgerSequence (currentLedger + 20, ~80s) has long passed, so a tx that
  // isn't validated can never be applied and its reserve is safely returned.
  // NOTE: point XRPL_RPC_URL at a FULL-HISTORY node in production so a validated
  // payout is always found here — otherwise a confirmed tx the node has pruned
  // could be wrongly re-credited (double-spend).
  if (action === 'reconcile') {
    if (!ADMIN_SECRET || req.headers.get('X-Treasury-Admin') !== ADMIN_SECRET) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: pending } = await admin
      .from('treasury_transactions')
      .select('idempotency_key, onchain_tx_hash')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .limit(100)

    const results: any[] = []
    for (const row of pending ?? []) {
      // No hash was ever captured → the tx never submitted → re-credit.
      if (!row.onchain_tx_hash) {
        const { data: fin } = await admin.rpc('treasury_finalize_payout', {
          p_idempotency_key: row.idempotency_key, p_success: false, p_tx_hash: null,
        })
        results.push({ idempotency_key: row.idempotency_key, success: false, status: (fin as any)?.status })
        continue
      }
      // Look it up on-chain. A transient RPC error → skip (retry next run); never
      // re-credit on an inconclusive lookup.
      let tx: any
      try {
        tx = await lookupTx(row.onchain_tx_hash)
      } catch (_) {
        results.push({ idempotency_key: row.idempotency_key, skipped: 'lookup_error' })
        continue
      }
      const success = tx?.validated === true && tx?.meta?.TransactionResult === 'tesSUCCESS'
      const { data: fin } = await admin.rpc('treasury_finalize_payout', {
        p_idempotency_key: row.idempotency_key,
        p_success: success,
        p_tx_hash: success ? row.onchain_tx_hash : null,
      })
      results.push({ idempotency_key: row.idempotency_key, success, status: (fin as any)?.status })
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

  // ─── balance ───────────────────────────────────────────────────────────────
  if (action === 'balance') {
    const { group_id } = body
    if (!group_id) return json({ ok: false, error: 'group_id_required' }, 400)
    const { data } = await admin
      .from('treasury_ledger')
      .select('balance_drops')
      .eq('group_id', group_id).eq('user_id', user.id).maybeSingle()
    return json({ ok: true, balance_drops: data?.balance_drops ?? 0 })
  }

  // ─── settle_group ──────────────────────────────────────────────────────────
  // Group creator ends the group: pay each member's remaining held balance back
  // to their wallet on-chain, then mark the group ended. Idempotent per member
  // (groupend:<group>:<user>), so a retry never double-pays.
  if (action === 'settle_group') {
    if (!TREASURY_SEED && SIGNER_SEEDS.length === 0) {
      return json({ ok: false, error: 'treasury_key_missing' }, 500)
    }
    const { group_id } = body
    if (!group_id) return json({ ok: false, error: 'group_id_required' }, 400)

    const { data: group } = await admin
      .from('groups').select('creator_id, status').eq('id', group_id).maybeSingle()
    if (!group) return json({ ok: false, error: 'group_not_found' }, 404)
    if (group.creator_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403)
    if (group.status !== 'active') return json({ ok: false, error: 'group_not_active' }, 400)

    const { data: rows } = await admin
      .from('treasury_ledger')
      .select('user_id, balance_drops')
      .eq('group_id', group_id).gt('balance_drops', 0)

    const { data: members } = await admin
      .from('group_members')
      .select('user_id, wallet_address').eq('group_id', group_id)
    const walletOf: Record<string, string> = {}
    for (const m of members ?? []) if (m.wallet_address) walletOf[m.user_id] = m.wallet_address

    const payouts: any[] = []
    for (const row of rows ?? []) {
      const destination = walletOf[row.user_id]
      if (!destination) {
        payouts.push({ user_id: row.user_id, ok: false, error: 'no_wallet' })
        continue
      }
      const r = await doPayout(admin, {
        group_id, user_id: row.user_id, destination,
        amount_drops: Number(row.balance_drops),
        kind: 'group_end_payout',
        idempotency_key: `groupend:${group_id}:${row.user_id}`,
      })
      payouts.push({ user_id: row.user_id, ...r })
    }

    // Only mark ended once every member payout settled (no failures / pendings).
    const allSettled = payouts.every(p => p.ok && !p.pending)
    if (allSettled) {
      await admin.from('groups').update({ status: 'ended' }).eq('id', group_id)
    }
    return json({ ok: allSettled, settled: allSettled, payouts })
  }

  // ─── confirm_deposit ───────────────────────────────────────────────────────
  if (action === 'confirm_deposit') {
    const { group_id, tx_hash } = body
    if (!group_id || !tx_hash) return json({ ok: false, error: 'invalid_params' }, 400)

    // Caller must be an active member, and we use their on-file wallet to ensure
    // they can only claim deposits sent from their own account.
    const { data: member } = await admin
      .from('group_members')
      .select('wallet_address, status')
      .eq('group_id', group_id).eq('user_id', user.id).maybeSingle()
    if (!member || member.status !== 'active') {
      return json({ ok: false, error: 'not_a_member' }, 403)
    }

    const tx = await lookupTx(tx_hash)
    const ok =
      tx?.validated === true &&
      tx?.meta?.TransactionResult === 'tesSUCCESS' &&
      tx?.TransactionType === 'Payment' &&
      tx?.Destination === TREASURY_ADDRESS &&
      (!member.wallet_address || tx?.Account === member.wallet_address)
    if (!ok) return json({ ok: false, error: 'deposit_not_verified' }, 400)

    // delivered_amount is authoritative; for XRP it's a drops string.
    const delivered = tx?.meta?.delivered_amount ?? tx?.Amount
    const amountDrops = Number(delivered)
    if (!Number.isInteger(amountDrops) || amountDrops <= 0) {
      return json({ ok: false, error: 'bad_amount' }, 400)
    }

    const { data: credit, error: credErr } = await admin.rpc('treasury_credit', {
      p_group_id: group_id, p_user_id: user.id, p_amount_drops: amountDrops,
      p_tx_hash: tx_hash, p_idempotency_key: tx_hash,
    })
    if (credErr) return json({ ok: false, error: credErr.message }, 500)
    return json({ ok: true, ...credit })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
