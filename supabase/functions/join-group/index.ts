import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const groupId = url.searchParams.get('group_id') ?? ''

  if (!groupId) {
    return new Response('Missing group_id', { status: 400, headers: CORS_HEADERS })
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...CORS_HEADERS,
      'Location': `scrolltax://join/${encodeURIComponent(groupId)}`,
    },
  })
})
