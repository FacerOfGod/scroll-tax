import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// XRPL JSON-RPC endpoint. Configurable via the XRPL_RPC_URL function secret so the
// same code verifies against testnet or mainnet; falls back to testnet when unset.
const XRPL_HTTP = Deno.env.get('XRPL_RPC_URL') ?? 'https://s.altnet.rippletest.net:51234'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: CORS })

  // Require a valid Supabase JWT
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }),
      { status: 401, headers: CORS })
  }

  let penalty_event_id: string
  let tx_hash: string
  try {
    const body = await req.json()
    penalty_event_id = body.penalty_event_id
    tx_hash          = body.tx_hash
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }),
      { status: 400, headers: CORS })
  }

  if (!penalty_event_id || !tx_hash) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_params' }),
      { status: 400, headers: CORS })
  }

  // Verify the transaction on XRPL testnet via the JSON-RPC HTTP endpoint
  let verified = false
  try {
    const resp = await fetch(XRPL_HTTP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'tx',
        params: [{ transaction: tx_hash, binary: false }],
      }),
    })
    const json = await resp.json()
    const result = json?.result
    verified =
      result?.meta?.TransactionResult === 'tesSUCCESS' &&
      result?.validated === true
  } catch (e) {
    console.error('XRPL lookup failed:', e)
    // verified stays false — we'll mark as unverified, not error out
  }

  // Update the penalty_events row — only on the caller's own row (ownership check)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: updated, error: updErr } = await admin
    .from('penalty_events')
    .update({ tx_verified: verified, tx_hash })
    .eq('id', penalty_event_id)
    .eq('user_id', user.id)  // prevent updating another user's row
    .select('id')

  if (updErr) {
    console.error('penalty_events update failed:', updErr)
    return new Response(JSON.stringify({ ok: false, error: 'update_failed' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  // No matching row → either the event id is wrong or it belongs to another user.
  if (!updated || updated.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'not_found_or_forbidden' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ ok: true, verified }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
