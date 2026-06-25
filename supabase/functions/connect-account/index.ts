// connect-account — links an external profile to the signed-in user.
//
//   chesscom / leetcode : body { provider, username }  → validated server-side
//   github              : body { provider, provider_token } → from linkIdentity
//   strava              : body { provider, code }       → OAuth code exchange
//
// Secret tokens (github/strava) are stored in oauth_tokens, which the client
// can never read. Non-secret display data goes in connected_accounts.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  Provider,
  chesscomExists,
  leetcodeExists,
  githubLogin,
  exchangeStravaCode,
  stravaAthlete,
} from '../_shared/providers.ts'

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  // Authenticate the caller via their Supabase JWT
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

  const provider = body.provider as Provider
  if (!provider || !['github', 'strava', 'chesscom', 'leetcode'].includes(provider)) {
    return json({ ok: false, error: 'invalid_provider' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let username: string | null = null

  try {
    if (provider === 'chesscom' || provider === 'leetcode') {
      username = String(body.username ?? '').trim()
      if (!username) return json({ ok: false, error: 'username_required' }, 400)
      // Chess.com is case-insensitive — store the canonical lowercase handle so later
      // settle-time stats reads resolve directly (no 301). LeetCode is case-sensitive.
      if (provider === 'chesscom') username = username.toLowerCase()
      const exists = provider === 'chesscom'
        ? await chesscomExists(username)
        : await leetcodeExists(username)
      if (!exists) return json({ ok: false, error: 'username_not_found' }, 404)
    } else if (provider === 'github') {
      const token = String(body.provider_token ?? '')
      if (!token) return json({ ok: false, error: 'provider_token_required' }, 400)
      username = await githubLogin(token)
      if (!username) return json({ ok: false, error: 'invalid_github_token' }, 400)
      const { error: tokErr } = await admin.from('oauth_tokens').upsert({
        user_id: user.id, provider: 'github',
        access_token: token, refresh_token: null, expires_at: null,
        updated_at: new Date().toISOString(),
      })
      if (tokErr) throw new Error('token_store_failed')
    } else if (provider === 'strava') {
      const code = String(body.code ?? '')
      if (!code) return json({ ok: false, error: 'code_required' }, 400)
      const clientId = Deno.env.get('STRAVA_CLIENT_ID')!
      const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET')!
      const tokens = await exchangeStravaCode(clientId, clientSecret, code)
      const athlete = await stravaAthlete(tokens.access_token)
      username = athlete?.username ?? String(athlete?.id ?? 'strava')
      const { error: tokErr } = await admin.from('oauth_tokens').upsert({
        user_id: user.id, provider: 'strava',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      if (tokErr) throw new Error('token_store_failed')
    }

    // Only record the public-facing account link once the token (if any) is stored,
    // so a failed token write never leaves a half-connected account.
    const { error: caErr } = await admin.from('connected_accounts').upsert(
      { user_id: user.id, provider, external_username: username, connected_at: new Date().toISOString() },
      { onConflict: 'user_id,provider' },
    )
    if (caErr) {
      // Surface the underlying Postgres failure (code/details/hint) — otherwise the
      // generic 'account_link_failed' hides the real cause (missing table, missing
      // UNIQUE(user_id,provider) for the ON CONFLICT, column mismatch, etc.).
      console.error('connected_accounts upsert failed:', caErr)
      throw new Error('account_link_failed')
    }
  } catch (e) {
    console.error('connect-account error:', e)
    return json({ ok: false, error: String((e as Error)?.message ?? 'connect_failed') }, 502)
  }

  return json({ ok: true, provider, username })
})
