require('dotenv').config()

const { Telegraf } = require('telegraf')

const { createClient } = require('@supabase/supabase-js')

const { generateAndStoreWallet, getTonAddress, getBalance, sendTon } = require('./walletService')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.use((ctx, next) => {
  if (ctx.message?.entities) {
    ctx.message.entities = ctx.message.entities.map(e =>
      e.type === 'text_link' && e.url?.startsWith('tg://bot_command?command=')
        ? { ...e, type: 'bot_command' }
        : e
    )
  }
  return next()
})

// When user types /start
bot.start(async (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply("⚠️ Please use /start in a private chat with me.")
  }

  const commandList = `Welcome to ScrollTaxBot 🚀

Here's what I can do:

/start — Show this message
/ping — Check if the bot is alive
/create — Create a new scroll-tax session
  Usage: /create -time <minutes> -stake <TON> [-penalty <TON>] [-apps <app1,app2>]
/close — Close your active session
/banned — Show banned apps in your current session
/join — Join a session by ID
/participants — List participants in your session
/wallet — View or create your TON wallet`

  await ctx.reply(commandList)

  const userId = ctx.from.id.toString()

  const { data: linked } = await supabase
    .from('linked_accounts')
    .select('*')
    .eq('telegram_id', userId)
    .single()

  if (!linked) {
    const linkUrl = `${process.env.SUPABASE_URL}/functions/v1/link?telegram_id=${userId}`
    await ctx.reply("📱 Link your ScrollTax account to get started:", {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔗 Link Account", url: linkUrl }
        ]]
      }
    })
  }
})

const isLinked = async (userId) => {
  const { data } = await supabase
    .from('linked_accounts')
    .select('*')
    .eq('telegram_id', userId)
    .single()
  return !!data
}

// Test command
bot.command('ping', (ctx) => {
  ctx.reply("pong 🏓")
})

bot.command('create', async (ctx) => {
  try {
    const userId = ctx.from.id.toString()
    console.log(`[create] userId=${userId}`)

    const linked = await isLinked(userId)
    console.log(`[create] isLinked=${linked}`)

    if (!linked) {
      return ctx.reply("❌ Please link your app account first by tapping the link sent at /start")
    }
    console.log(`[create] Here`)


    const text = ctx.message.text
    const timeMatch = text.match(/-time\s+(\d+)/)
    const stakeMatch = text.match(/-stake\s+(\d+)/)

    if (!timeMatch || !stakeMatch) {
      return ctx.reply("❌ Usage:\n/create -time 120 -stake 5 -penalty 0.5\n\n-penalty is optional (TON deducted per 30s violation)")
    }

    const duration = parseInt(timeMatch[1])
    const stake = parseInt(stakeMatch[1])
    const penaltyMatch = text.match(/-penalty\s+(\d+(?:\.\d+)?)/)
    const penaltyRate = penaltyMatch ? parseFloat(penaltyMatch[1]) : 0
    console.log(`[create] duration=${duration} stake=${stake} penaltyRate=${penaltyRate}`)

    // Block creation if wallet is missing or underfunded
    const tonAddress = await getTonAddress(supabase, userId)
    if (!tonAddress) {
      return ctx.reply(`❌ You need a TON wallet to create a session.\n\nRun /wallet to create one, then top it up with at least ${stake} TON.`)
    }

    try {
      const balance = await getBalance(tonAddress)
      if (parseFloat(balance) < stake) {
        return ctx.reply(`❌ Insufficient balance.\n\n💰 Your balance: ${parseFloat(balance).toFixed(2)} TON\n🎯 Required stake: ${stake} TON\n\nTop up your wallet and try again.`)
      }
    } catch (e) {
      return ctx.reply(`❌ Could not verify your TON balance: ${e.message}\n\nPlease try again shortly.`)
    }

    const KNOWN_APPS = {
      tiktok:    'com.zhiliaoapp.musically',
      instagram: 'com.instagram.android',
      youtube:   'com.google.android.youtube',
      whatsapp:  'com.whatsapp',
    }
    const ALL_APP_IDS = Object.values(KNOWN_APPS)

    const appsMatch = text.match(/-apps\s+([\w,]+)/)
    let bannedApps = ALL_APP_IDS
    if (appsMatch) {
      const requested = appsMatch[1].toLowerCase().split(',').map(s => s.trim())
      bannedApps = requested
        .map(name => KNOWN_APPS[name])
        .filter(Boolean)
      if (bannedApps.length === 0) {
        return ctx.reply(`❌ No valid apps. Choose from: ${Object.keys(KNOWN_APPS).join(', ')}`)
      }
    }

    const chatId = ctx.chat.id.toString()

    const { data: existing } = await supabase
      .from('sessions')
      .select('id')
      .eq('chat_id', chatId)
      .eq('status', 'active')
      .single()

    if (existing) {
      return ctx.reply(`❌ This group already has an active session (ID: ${existing.id.slice(0, 8)}…)\n\nThe owner can end it with /close`)
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert([{ duration, stake, penalty_rate: penaltyRate, status: 'active', chat_id: chatId, created_by: userId, banned_apps: bannedApps }])
      .select()

    console.log(`[create] insert result: data=${JSON.stringify(data)} error=${JSON.stringify(error)}`)

    if (error) return ctx.reply(`❌ Error creating session: ${error.message}`)

    const sessionId = data[0].id
    const username = ctx.from.username || ctx.from.first_name

    const { error: joinError } = await supabase
      .from('participants')
      .insert([{ session_id: sessionId, user_id: userId, username }])

    if (joinError) return ctx.reply(`❌ Session created but failed to join: ${joinError.message}`)

    const APP_LABELS = {
      'com.zhiliaoapp.musically':   'TikTok',
      'com.instagram.android':      'Instagram',
      'com.google.android.youtube': 'YouTube',
      'com.whatsapp':               'WhatsApp',
    }
    const bannedList = bannedApps.map(id => APP_LABELS[id] || id).join(', ')

    const penaltyLine = penaltyRate > 0 ? `\n⚡ Penalty: ${penaltyRate} TON / 30s` : ''
    ctx.reply(
      `🚀 Session started!\n\n🆔 ID: ${sessionId}\n⏱ ${duration} min\n💰 ${stake} TON${penaltyLine}\n📵 Banned: ${bannedList}\n\n👤 ${username} joined automatically\n\nShare the button below so others can join:`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔗 Join Session', callback_data: `join:${sessionId}` }
          ]]
        }
      }
    )
  } catch (e) {
    console.error('[create] unhandled error:', e)
    ctx.reply(`❌ Unexpected error: ${e.message}`)
  }
})

bot.command('close', async (ctx) => {
  try {
    const userId = ctx.from.id.toString()
    const chatId = ctx.chat.id.toString()

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, created_by, stake, duration')
      .eq('chat_id', chatId)
      .eq('status', 'active')
      .single()

    if (error || !session) {
      return ctx.reply('❌ No active session in this group.')
    }

    if (session.created_by !== userId) {
      return ctx.reply('❌ Only the session owner can close it.')
    }

    await supabase
      .from('sessions')
      .update({ status: 'ended' })
      .eq('id', session.id)

    const { data: participants } = await supabase
      .from('participants')
      .select('user_id, username')
      .eq('session_id', session.id)

    ctx.reply(`🔒 Session closed by @${ctx.from.username || ctx.from.first_name}.\n\n💰 Stakes will be returned — no penalties applied.`)

    if (participants) {
      for (const p of participants) {
        bot.telegram.sendMessage(
          p.user_id,
          `🔒 Your session has been closed early by the owner.\n💰 No penalties — your stake is safe.`
        ).catch(() => {})
      }
    }
  } catch (e) {
    console.error('[close] unhandled error:', e)
    ctx.reply(`❌ Unexpected error: ${e.message}`)
  }
})

bot.command('banned', async (ctx) => {
  const chatId = ctx.chat.id.toString()

  const { data: session } = await supabase
    .from('sessions')
    .select('banned_apps')
    .eq('chat_id', chatId)
    .eq('status', 'active')
    .single()

  if (!session) {
    return ctx.reply('❌ No active session in this group.')
  }

  const APP_LABELS = {
    'com.zhiliaoapp.musically':   'TikTok',
    'com.instagram.android':      'Instagram',
    'com.google.android.youtube': 'YouTube',
    'com.whatsapp':               'WhatsApp',
  }

  const apps = session.banned_apps || []
  if (apps.length === 0) {
    return ctx.reply('📵 No apps are banned in this session.')
  }

  const list = apps.map(id => `• ${APP_LABELS[id] || id}`).join('\n')
  ctx.reply(`📵 Banned apps this session:\n\n${list}`)
})

bot.action(/^join:(.+)$/, async (ctx) => {
  const sessionId = ctx.match[1]
  const telegramId = ctx.from.id.toString()

  await ctx.answerCbQuery()

  // Fetch session to get the required stake
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('stake')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    await ctx.telegram.sendMessage(telegramId, '❌ Session not found.')
    return
  }

  // Check wallet exists and has sufficient funds
  const tonAddress = await getTonAddress(supabase, telegramId)
  if (!tonAddress) {
    await ctx.telegram.sendMessage(telegramId, `❌ You need a TON wallet to join this session.\n\nRun /wallet to create one, then top it up with at least ${session.stake} TON.`)
    return
  }

  try {
    const balance = await getBalance(tonAddress)
    if (parseFloat(balance) < session.stake) {
      await ctx.telegram.sendMessage(telegramId, `❌ Insufficient funds.\n\n💰 Your balance: ${parseFloat(balance).toFixed(2)} TON\n🎯 Required stake: ${session.stake} TON\n\nTop up your wallet and try again.`)
      return
    }
  } catch (e) {
    await ctx.telegram.sendMessage(telegramId, `❌ Could not verify your TON balance: ${e.message}\n\nPlease try again shortly.`)
    return
  }

  const joinUrl = `${process.env.SUPABASE_URL}/functions/v1/join?session_id=${sessionId}&telegram_id=${telegramId}`

  try {
    await ctx.telegram.sendMessage(telegramId, '👇 Tap to join the session and link your ScrollTax account:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🔗 Open ScrollTax', url: joinUrl }
        ]]
      }
    })
  } catch (e) {
    const name = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name
    await ctx.reply(`${name}, please start a private chat with me first, then tap Join Session again.`)
  }
})

bot.command('join', async (ctx) => {
  const userId = ctx.from.id.toString()

  if (!await isLinked(userId)) {
    return ctx.reply("❌ Please link your app account first by tapping the link sent at /start")
  }

  const text = ctx.message.text
  const parts = text.split(' ')

  if (parts.length < 2) {
    return ctx.reply("❌ Usage:\n/join SESSION_ID")
  }

  const sessionId = parts[1]
  const username = ctx.from.username || ctx.from.first_name

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return ctx.reply("❌ Session not found")
  }

  // Block joining if wallet is missing or underfunded
  const tonAddress = await getTonAddress(supabase, userId)
  if (!tonAddress) {
    return ctx.reply(`❌ You need a TON wallet to join this session.\n\nRun /wallet to create one, then top it up with at least ${session.stake} TON.`)
  }

  try {
    const balance = await getBalance(tonAddress)
    if (parseFloat(balance) < session.stake) {
      return ctx.reply(`❌ Insufficient balance.\n\n💰 Your balance: ${parseFloat(balance).toFixed(2)} TON\n🎯 Required stake: ${session.stake} TON\n\nTop up your wallet and try again.`)
    }
  } catch (e) {
    return ctx.reply(`❌ Could not verify your TON balance: ${e.message}\n\nPlease try again shortly.`)
  }

  const { error } = await supabase
    .from('participants')
    .insert([{ session_id: sessionId, user_id: userId, username }])

  if (error) {
    console.error(error)
    return ctx.reply("❌ Error joining session")
  }

  ctx.reply(`✅ Joined session!\n🆔 ${sessionId}`)
})

bot.command('participants', async (ctx) => {
  const chatId = ctx.chat.id.toString()

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('chat_id', chatId)
    .eq('status', 'active')
    .single()

  if (sessionError || !session) {
    return ctx.reply("❌ No active session in this group")
  }

  const { data, error } = await supabase
    .from('participants')
    .select('*')
    .eq('session_id', session.id)

  if (error) {
    console.error(error)
    return ctx.reply("❌ Error fetching participants")
  }

  if (!data || data.length === 0) {
    return ctx.reply("👤 No participants yet")
  }

  const list = data.map(p => `- ${p.username}`).join('\n')

  ctx.reply(`👥 Participants:\n${list}`)
})


bot.command('wallet', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply("⚠️ Please use /wallet in a private chat with me.")
  }

  const userId = ctx.from.id.toString()

  if (!await isLinked(userId)) {
    return ctx.reply("❌ Please link your app account first by tapping the link sent at /start")
  }

  const tonAddress = await generateAndStoreWallet(supabase, userId)

  let balanceText
  try {
    const balance = await getBalance(tonAddress)
    balanceText = `${parseFloat(balance).toFixed(2)} TON`
  } catch (e) {
    balanceText = `unavailable (${e.message})`
  }

  ctx.reply(
    `💎 Your TON wallet\n\n📬 Address:\n${tonAddress}\n\n💰 Balance: ${balanceText}\n\nFund this address to participate in TON sessions.\n\n💡 On testnet, get free test TON from @testgiver_ton_bot`
  )
})

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id.toString()

  if (!await isLinked(userId)) {
    return ctx.reply("❌ Please link your app account first by tapping the link sent at /start")
  }

  const tonAddress = await getTonAddress(supabase, userId)
  if (!tonAddress) {
    return ctx.reply("❌ No wallet yet. Run /wallet to create one.")
  }

  let balanceText
  try {
    const balance = await getBalance(tonAddress)
    balanceText = `${parseFloat(balance).toFixed(2)} TON`
  } catch (e) {
    balanceText = `unavailable (${e.message})`
  }
  ctx.reply(`💰 Balance: ${balanceText}`)
})

// Session end timer — checks every minute for expired sessions
setInterval(async () => {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('status', 'active')

  if (!sessions || sessions.length === 0) return

  for (const session of sessions) {
    const endsAt = new Date(new Date(session.created_at).getTime() + session.duration * 60 * 1000)

    if (new Date() < endsAt) continue

    // Mark session as ended
    await supabase
      .from('sessions')
      .update({ status: 'ended' })
      .eq('id', session.id)

    // Fetch participants
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('session_id', session.id)

    if (!participants || participants.length === 0) continue

    // Fetch deductions for this session
    const { data: deductions } = await supabase
      .from('deductions')
      .select('*')
      .eq('session_id', session.id)

    // Calculate final balance per participant
    const balances = {}
    for (const p of participants) {
      balances[p.user_id] = session.stake
    }

    if (deductions && deductions.length > 0) {
      for (const d of deductions) {
        if (balances[d.telegram_id] !== undefined) {
          balances[d.telegram_id] -= d.amount
        }
        // Distribute deducted amount among other participants
        const others = participants.filter(p => p.user_id !== d.telegram_id)
        if (others.length > 0) {
          const share = d.amount / others.length
          for (const o of others) {
            balances[o.user_id] += share
          }
        }
      }
    }

    // Fetch TON wallets for all participants
    const participantIds = participants.map(p => p.user_id)
    const { data: tonWallets } = await supabase
      .from('ton_wallets')
      .select('telegram_id, ton_address')
      .in('telegram_id', participantIds)

    const walletMap = {}
    if (tonWallets) {
      for (const w of tonWallets) walletMap[w.telegram_id] = w.ton_address
    }

    // Execute TON transfers at session end (only for sessions without live penalty transfers)
    const transferResults = {}
    if (!session.penalty_rate || session.penalty_rate === 0) {
      for (const payer of participants) {
        const net = balances[payer.user_id] - session.stake
        if (net >= 0) continue  // winner or break-even, nothing to send

        const owed = Math.abs(net)
        const winners = participants.filter(p => balances[p.user_id] > session.stake)

        if (winners.length === 0) continue
        if (!walletMap[payer.user_id]) {
          transferResults[payer.user_id] = '⚠️ No TON wallet — run /wallet'
          continue
        }

        const share = owed / winners.length
        let transferOk = true

        for (const winner of winners) {
          const winnerAddress = walletMap[winner.user_id]
          if (!winnerAddress) continue
          try {
            await sendTon(supabase, payer.user_id, winnerAddress, share.toFixed(6))
          } catch (e) {
            console.error(`TON transfer failed ${payer.user_id} -> ${winner.user_id}:`, e.message)
            transferResults[payer.user_id] = `❌ Transfer failed: ${e.message}`
            transferOk = false
            break
          }
        }

        if (transferOk) transferResults[payer.user_id] = '✅ Sent'
      }
    }

    // Build result message
    const lines = participants.map(p => {
      const balance = balances[p.user_id].toFixed(2)
      const txStatus = transferResults[p.user_id] ? ` ${transferResults[p.user_id]}` : ''
      return `@${p.username}: ${balance} TON${txStatus}`
    })

    const message = `🏁 Session ended!\n\n💰 Final balances:\n${lines.join('\n')}`

    // Notify all participants
    for (const participant of participants) {
      bot.telegram.sendMessage(participant.user_id, message)
    }
  }
}, 60 * 1000)

// Deduction listener — Realtime INSERT on deductions table
const processDeduction = async (deduction) => {
  const { session_id, telegram_id, amount, app_name } = deduction

  const [participantsResult, sessionResult] = await Promise.all([
    supabase.from('participants').select('*').eq('session_id', session_id),
    supabase.from('sessions').select('chat_id, penalty_rate').eq('id', session_id).single(),
  ])

  const chatId = sessionResult.data?.chat_id
  const penaltyRate = sessionResult.data?.penalty_rate || 0
  const participants = participantsResult.data
  if (!participants || participants.length === 0) return

  const culprit = participants.find(p => p.user_id === telegram_id)
  let culpritName = 'Someone'
  if (culprit) {
    try {
      const chat = await bot.telegram.getChat(parseInt(telegram_id))
      culpritName = chat.username ? `@${chat.username}` : (chat.first_name || 'Someone')
    } catch {
      culpritName = `@${culprit.username}`
    }
  }
  const app = app_name || 'a banned app'
  const others = participants.filter(p => p.user_id !== telegram_id)
  const share = others.length > 0
    ? ` (+${(penaltyRate / others.length).toFixed(2)} TON each to the ${others.length} other${others.length > 1 ? 's' : ''})`
    : ''

  const shameMessages = [
    `🚨 CAUGHT RED-HANDED!\n\n${culpritName} was using ${app} during the session.\n\n💸 ${penaltyRate} TON penalty deducted from their stake${share}.\n\nMaybe touch grass instead? 🌿`,
    `📵 DISTRACTION ALERT!\n\n${culpritName} opened ${app} — ScrollTax was watching 👀\n\n💸 −${penaltyRate} TON penalty. The group thanks you! 😇`,
    `😳 THE AUDACITY!\n\n${culpritName} thought they could sneak in some ${app} time.\n\nThought wrong. 💸 −${penaltyRate} TON penalty. Shame!`,
    `🙈 BUSTED!\n\n${culpritName} couldn't resist ${app} for 30 seconds.\n\n💸 ${penaltyRate} TON penalty has left the chat.${share}`,
    `⚠️ WEAK FOCUS ENERGY\n\n${culpritName} was on ${app} during the session.\n\n💸 ${penaltyRate} TON penalty applied${share}. Stay off your phone! 📵`,
  ]
  const shame = shameMessages[Math.floor(Math.random() * shameMessages.length)]

  if (chatId) {
    await bot.telegram.sendMessage(chatId, shame)
    console.log(`[deduction] shamed ${culpritName} in chat ${chatId}`)
  } else {
    console.log('[deduction] no chat_id, DMing participants')
    for (const p of participants) {
      bot.telegram.sendMessage(p.user_id, shame).catch(() => {})
    }
  }

  // Immediately transfer penalty TON from offender to others
  if (penaltyRate > 0 && others.length > 0) {
    const participantIds = participants.map(p => p.user_id)
    const { data: tonWallets } = await supabase
      .from('ton_wallets')
      .select('telegram_id, ton_address')
      .in('telegram_id', participantIds)

    const walletMap = {}
    if (tonWallets) for (const w of tonWallets) walletMap[w.telegram_id] = w.ton_address

    if (!walletMap[telegram_id]) {
      console.log(`[deduction] offender ${telegram_id} has no wallet — skipping transfer`)
      return
    }

    const perPerson = (penaltyRate / others.length).toFixed(6)
    const transferStatuses = []

    for (const recipient of others) {
      const toAddress = walletMap[recipient.user_id]
      if (!toAddress) continue
      let recipientName = recipient.username
      try {
        const recipientChat = await bot.telegram.getChat(parseInt(recipient.user_id))
        recipientName = recipientChat.username ? `@${recipientChat.username}` : (recipientChat.first_name || recipient.user_id)
      } catch {}
      try {
        await sendTon(supabase, telegram_id, toAddress, perPerson)
        transferStatuses.push(`✅ ${perPerson} TON → ${recipientName}`)
        console.log(`[deduction] transferred ${perPerson} TON from ${telegram_id} to ${recipient.user_id}`)
      } catch (e) {
        transferStatuses.push(`❌ Failed → ${recipientName}: ${e.message}`)
        console.error(`[deduction] transfer failed ${telegram_id} -> ${recipient.user_id}:`, e.message)
      }
      await new Promise(r => setTimeout(r, 4000)) // stay under toncenter rate limit
    }

    const txMessage = `💸 Live penalty transfers:\n${transferStatuses.join('\n')}`
    if (chatId) {
      bot.telegram.sendMessage(chatId, txMessage).catch(() => {})
    }
  }
}

supabase
  .channel('deductions-insert')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deductions' }, async (payload) => {
    console.log('[deduction] received INSERT:', payload.new)
    await processDeduction(payload.new).catch(err =>
      console.error('[deduction] processDeduction error:', err.message)
    )
  })
  .subscribe((status) => {
    console.log('[deduction] realtime status:', status)
  })

// Launch bot
bot.launch()

console.log("Bot is running...")

// Proper stop (optional but clean)
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))