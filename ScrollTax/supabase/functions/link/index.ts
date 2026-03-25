import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve((req: Request) => {
  const url = new URL(req.url)
  const telegramId = url.searchParams.get('telegram_id') ?? ''

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `scrolltax://link?telegram_id=${encodeURIComponent(telegramId)}`,
    },
  })
})
