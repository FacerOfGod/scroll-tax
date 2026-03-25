import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve((req: Request) => {
  const url = new URL(req.url)
  const groupId = url.searchParams.get('group_id') ?? ''

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `scrolltax://join/${encodeURIComponent(groupId)}`,
    },
  })
})
