import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve((req: Request) => {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session_id') ?? ''
  const telegramId = url.searchParams.get('telegram_id') ?? ''

  const deepLink = `scrolltax://session?id=${encodeURIComponent(sessionId)}&telegram_id=${encodeURIComponent(telegramId)}`

  return new Response(null, {
    status: 302,
    headers: { 'Location': deepLink },
  })
})
