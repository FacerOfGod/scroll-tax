// Proves the production custody hardening: a 2-of-3 MULTISIG treasury payout on
// testnet. The treasury account is configured with a SignerList of 3 signer keys
// (quorum 2); a payout is then signed by 2 of them, combined, and submitted.
//
// Run: node scripts/treasury-multisign-demo.mjs
//
// In production the 3 signer keys live in separate secure stores (e.g. distinct
// KMS/HSM custodians) so no single party can move funds — and the treasury's
// master key is disabled (see the commented AccountSet below).

import { Client, Wallet, multisign, xrpToDrops } from 'xrpl';

const client = new Client('wss://s.altnet.rippletest.net:51233');

async function fundNew(label) {
  const { wallet, balance } = await client.fundWallet();
  console.log(`  funded ${label}: ${wallet.address} (${balance} XRP)`);
  return wallet;
}

async function submit(tx_blob, label) {
  const res = await client.submitAndWait(tx_blob);
  const code = res.result.meta?.TransactionResult;
  console.log(`  ${label}: tx=${res.result.hash} result=${code}`);
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`);
  return res.result;
}

const bal = async a => Number(await client.getXrpBalance(a));

(async () => {
  console.log('connecting to testnet ...');
  await client.connect();

  console.log('funding accounts ...');
  const treasury = await fundNew('TREASURY');
  const recipient = await fundNew('RECIPIENT');
  // Signer keys never hold or pay XRP — they only authorize. No faucet needed.
  const signers = [Wallet.generate(), Wallet.generate(), Wallet.generate()];
  signers.forEach((s, i) => console.log(`  signer ${i + 1}: ${s.address}`));

  // 1. install a 2-of-3 SignerList on the treasury (signed by its master key)
  console.log('\nsetting 2-of-3 SignerList ...');
  const slSet = await client.autofill({
    TransactionType: 'SignerListSet',
    Account: treasury.address,
    SignerQuorum: 2,
    SignerEntries: signers.map(s => ({
      SignerEntry: { Account: s.address, SignerWeight: 1 },
    })),
  });
  await submit(treasury.sign(slSet).tx_blob, 'SignerListSet');

  // (production) disable the master key so ONLY the signer set can move funds:
  // const dm = await client.autofill({ TransactionType: 'AccountSet', Account: treasury.address, SetFlag: 4 });
  // await submit(treasury.sign(dm).tx_blob, 'DisableMaster');

  // 2. multisigned payout: 2 of the 3 signers authorize, combine, submit
  console.log('\nmultisigned payout treasury -> recipient ...');
  console.log(`before  treasury=${await bal(treasury.address)}  recipient=${await bal(recipient.address)}`);
  // The 2nd autofill arg is the signer count, so the fee is scaled for multisign.
  const payment = await client.autofill({
    TransactionType: 'Payment',
    Account: treasury.address,
    Destination: recipient.address,
    Amount: xrpToDrops('5'),
  }, 2);
  const blob1 = signers[0].sign(payment, true).tx_blob;
  const blob2 = signers[1].sign(payment, true).tx_blob;
  await submit(multisign([blob1, blob2]), 'Multisigned Payment');
  console.log(`after   treasury=${await bal(treasury.address)}  recipient=${await bal(recipient.address)}`);

  await client.disconnect();
  console.log('\n✅ 2-of-3 multisig treasury payout works on testnet.');
})().catch(async e => {
  console.error('\n❌ multisig demo failed:', e?.message ?? e);
  try { await client.disconnect(); } catch {}
  process.exit(1);
});
