// Operator tool: install a multisig SignerList on an EXISTING treasury account.
//
// Configure via env, then run:  node scripts/treasury-setup-signerlist.mjs
//   TREASURY_SEED              master seed of the treasury account (required)
//   TREASURY_SIGNER_ADDRESSES  comma-separated signer addresses (required)
//   TREASURY_SIGNER_QUORUM     signatures required (default: majority)
//   XRPL_WSS_URL               node URL (default: testnet)
//   DISABLE_MASTER=true        also disable the master key so ONLY the signer
//                              set can move funds (irreversible-ish — be sure the
//                              SignerList works first!)
//
// The matching TREASURY_SIGNER_SEEDS (the seeds for these addresses) are set as
// the treasury edge function's multisign secret — kept in separate secure stores
// in production, never all in one place.

import { Client, Wallet } from 'xrpl';

const WSS = process.env.XRPL_WSS_URL || 'wss://s.altnet.rippletest.net:51233';
const seed = process.env.TREASURY_SEED;
const addresses = (process.env.TREASURY_SIGNER_ADDRESSES || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const quorum = Number(process.env.TREASURY_SIGNER_QUORUM || Math.floor(addresses.length / 2) + 1);
const disableMaster = process.env.DISABLE_MASTER === 'true';

if (!seed) { console.error('Missing TREASURY_SEED'); process.exit(1); }
if (addresses.length < 1) { console.error('Missing TREASURY_SIGNER_ADDRESSES'); process.exit(1); }
if (quorum < 1 || quorum > addresses.length) { console.error('Bad TREASURY_SIGNER_QUORUM'); process.exit(1); }

const client = new Client(WSS);

async function submit(wallet, tx, label) {
  const prepared = await client.autofill(tx);
  const res = await client.submitAndWait(wallet.sign(prepared).tx_blob);
  const code = res.result.meta?.TransactionResult;
  console.log(`  ${label}: tx=${res.result.hash} result=${code}`);
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`);
}

(async () => {
  await client.connect();
  const treasury = Wallet.fromSeed(seed);
  console.log(`treasury ${treasury.address} on ${WSS}`);
  console.log(`installing ${quorum}-of-${addresses.length} SignerList ...`);

  await submit(treasury, {
    TransactionType: 'SignerListSet',
    Account: treasury.address,
    SignerQuorum: quorum,
    SignerEntries: addresses.map(a => ({ SignerEntry: { Account: a, SignerWeight: 1 } })),
  }, 'SignerListSet');

  if (disableMaster) {
    console.log('disabling master key (SetFlag asfDisableMaster=4) ...');
    await submit(treasury, {
      TransactionType: 'AccountSet', Account: treasury.address, SetFlag: 4,
    }, 'DisableMaster');
  }

  await client.disconnect();
  console.log('\n✅ SignerList installed. Set TREASURY_SIGNER_SEEDS in the edge function secrets.');
})().catch(async e => {
  console.error('\n❌ setup failed:', e?.message ?? e);
  try { await client.disconnect(); } catch {}
  process.exit(1);
});
