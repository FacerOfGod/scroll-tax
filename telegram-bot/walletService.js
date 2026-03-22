require('dotenv').config()

const { TonClient, WalletContractV4, Address, fromNano, toNano, internal } = require('@ton/ton')
const { mnemonicNew, mnemonicToWalletKey } = require('@ton/crypto')
const crypto = require('crypto')

const ENCRYPTION_KEY = Buffer.from(process.env.BOT_ENCRYPTION_KEY, 'hex')

// ─── Encryption ──────────────────────────────────────────────────────────────

function encryptSeed(mnemonic) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv)
  const text = mnemonic.join(' ')
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decryptSeed(encryptedSeed) {
  const [ivHex, dataHex] = encryptedSeed.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8').split(' ')
}

// ─── TON Client ──────────────────────────────────────────────────────────────

function getTonClient() {
  return new TonClient({ endpoint: process.env.TON_ENDPOINT })
}

// ─── Wallet Operations ───────────────────────────────────────────────────────

/**
 * Creates a TON wallet for the user if one doesn't exist, then returns the address.
 * Idempotent — safe to call multiple times.
 */
async function generateAndStoreWallet(supabase, telegramId) {
  const { data: existing } = await supabase
    .from('ton_wallets')
    .select('ton_address')
    .eq('telegram_id', telegramId)
    .single()

  if (existing) return existing.ton_address

  const mnemonic = await mnemonicNew(24)
  const keyPair = await mnemonicToWalletKey(mnemonic)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
  const tonAddress = wallet.address.toString({ bounceable: false })
  const encryptedSeed = encryptSeed(mnemonic)

  await supabase.from('ton_wallets').insert({
    telegram_id: telegramId,
    ton_address: tonAddress,
    encrypted_seed: encryptedSeed,
  })

  return tonAddress
}

/**
 * Returns the stored TON address for a telegram user, or null if none.
 */
async function getTonAddress(supabase, telegramId) {
  const { data } = await supabase
    .from('ton_wallets')
    .select('ton_address')
    .eq('telegram_id', telegramId)
    .single()
  return data?.ton_address ?? null
}

/**
 * Returns the TON balance for an address as a human-readable string (e.g. "1.50").
 */
async function getBalance(tonAddress) {
  try {
    const client = getTonClient()
    const balance = await client.getBalance(Address.parse(tonAddress))
    return fromNano(balance)
  } catch (e) {
    console.error('getBalance error:', e.message)
    throw e
  }
}

/**
 * Sends TON from one user's wallet to a destination address.
 * Uses sequential await — do NOT call Promise.all on this for the same sender.
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sendTon(supabase, fromTelegramId, toAddress, amountTon, retries = 5) {
  const { data } = await supabase
    .from('ton_wallets')
    .select('encrypted_seed')
    .eq('telegram_id', fromTelegramId)
    .single()

  if (!data) throw new Error(`No wallet found for telegram_id ${fromTelegramId}`)

  const mnemonic = decryptSeed(data.encrypted_seed)
  const keyPair = await mnemonicToWalletKey(mnemonic)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = getTonClient()
      const contract = client.open(wallet)
      const seqno = await contract.getSeqno()
      await sleep(1000) // gap between getSeqno and sendTransfer to avoid bursting

      await contract.sendTransfer({
        secretKey: keyPair.secretKey,
        seqno,
        messages: [
          internal({
            to: toAddress,
            value: toNano(String(amountTon)),
            bounce: false,
          }),
        ],
      })
      return
    } catch (e) {
      const is429 = e.message?.includes('429') || e.response?.status === 429
      if (is429 && attempt < retries) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000) // 2s, 4s, 8s, 16s, 30s cap
        console.warn(`[sendTon] 429 rate limit, retrying in ${delay}ms (attempt ${attempt}/${retries})`)
        await sleep(delay)
      } else {
        throw e
      }
    }
  }
}

module.exports = { generateAndStoreWallet, getTonAddress, getBalance, sendTon }
