// self-bet — opens, reports progress on, and settles solo "bet on yourself" wagers.
//
//   action 'create'   : capture the server-side baseline, lock the stake (RPC)
//   action 'progress'  : read current metric vs target (no state change)
//   action 'settle'    : if the target is met OR the deadline passed, close the bet
//
// All metric reads happen here (server-side) so the user can never spoof them.
// Token stake math is done atomically in the open_self_bet / settle_self_bet RPCs.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  Provider,
  Metric,
  METRIC_FOR,
  measureMetric,
  refreshStravaToken,
} from '../_shared/providers.ts'

// Where forfeited XRP stakes are sent. Configurable via the HOUSE_WALLET function
// secret (same address the penalty flow uses); falls back to a testnet address.
const DEV_WALLET = Deno.env.get('HOUSE_WALLET') ?? 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

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

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return json({ ok: false, error: 'unauthenticated' }, 401)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const action = body.action as string

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

      const periodStart = new Date()
      const periodEnd = new Date(periodStart.getTime() + periodDays * 86_400_000)

      // Baseline is measured from period_start so github/strava in-window counts start at ~0.
      const ctx = await measureCtxFor(admin, user.id, provider, periodStart.toISOString())
      const baseline = await measureMetric(provider, ctx)

      const { data: rpc, error: rpcErr } = await admin.rpc('open_self_bet', {
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
      return json(rpc)
    }

    // ─── progress / settle share the bet lookup + measurement ─────────────────
    if (action === 'progress' || action === 'settle') {
      const betId = body.bet_id as string
      if (!betId) return json({ ok: false, error: 'bet_id_required' }, 400)

      const { data: bet } = await admin
        .from('self_bets').select('*').eq('id', betId).maybeSingle()
      if (!bet) return json({ ok: false, error: 'bet_not_found' }, 404)
      if (bet.user_id !== user.id) return json({ ok: false, error: 'forbidden' }, 403)

      // Already-settled bets just echo their stored outcome.
      if (bet.status !== 'active') {
        return json({
          ok: true, settled: true, status: bet.status,
          current: bet.final_value, baseline: bet.baseline,
          progress: (bet.final_value ?? bet.baseline) - bet.baseline,
          target: bet.target_count,
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
      const { data: rpc, error: rpcErr } = await admin.rpc('settle_self_bet', {
        p_bet_id: betId,
        p_final_value: current,
      })
      if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500)

      const result: any = { ok: true, settled: true, ...rpc, ...base }
      // For an XRP loss the device must send the on-chain forfeit itself.
      if (rpc?.status === 'lost' && rpc?.stake_type === 'xrp') {
        result.xrp_forfeit = { amount: rpc.stake_amount, dest: DEV_WALLET }
      }
      return json(result)
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('self-bet error:', e)
    return json({ ok: false, error: String((e as Error)?.message ?? 'self_bet_failed') }, 502)
  }
})
