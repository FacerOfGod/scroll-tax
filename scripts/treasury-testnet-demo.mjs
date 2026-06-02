// Working testnet slice for the custodial (omnibus) treasury model.
//
// Demonstrates the end-to-end money flow under Phase 2:
//   1. fund a backend-controlled TREASURY account (testnet faucet)
//   2. fund a USER account (testnet faucet)
//   3. user deposits a stake -> treasury (user signs, holds own key)
//   4. treasury pays out -> user (backend signs from the treasury key)
//
// Run: node scripts/treasury-testnet-demo.mjs
// Nothing here is production custody — it uses a single throwaway treasury key on
// testnet. The real edge function mirrors steps 3-4 with a KMS-held/multisig key.

import { Client, xrpToDrops } from 'xrpl';

const TESTNET = 'wss://s.altnet.rippletest.net:51233';
const client = new Client(TESTNET);

async function fundNew(label) {
  const { wallet, balance } = await client.fundWallet();
  console.log(`  funded ${label}: ${wallet.address} (${balance} XRP)`);
  return wallet;
}

async function pay(from, destination, amountXrp, label) {
  const prepared = await client.autofill({
    TransactionType: 'Payment',
    Account: from.address,
    Destination: destination,
    Amount: xrpToDrops(amountXrp),
  });
  const signed = from.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const code = res.result.meta?.TransactionResult;
  console.log(`  ${label}: ${amountXrp} XRP  tx=${res.result.hash}  result=${code}`);
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`);
  return res.result;
}

const bal = async addr => Number(await client.getXrpBalance(addr));

(async () => {
  console.log(`connecting to ${TESTNET} ...`);
  await client.connect();

  console.log('funding accounts via faucet ...');
  const treasury = await fundNew('TREASURY');
  const user = await fundNew('USER');

  const stake = '10';
  const refund = '4'; // e.g. partial stake returned at group end after a penalty

  console.log(`\nbefore deposit  treasury=${await bal(treasury.address)}  user=${await bal(user.address)}`);
  await pay(user, treasury.address, stake, 'DEPOSIT  user->treasury');
  console.log(`after deposit   treasury=${await bal(treasury.address)}  user=${await bal(user.address)}`);

  await pay(treasury, user.address, refund, 'PAYOUT   treasury->user');
  console.log(`after payout    treasury=${await bal(treasury.address)}  user=${await bal(user.address)}`);

  await client.disconnect();
  console.log('\n✅ custodial treasury flow works on testnet.');
})().catch(async e => {
  console.error('\n❌ demo failed:', e?.message ?? e);
  try { await client.disconnect(); } catch {}
  process.exit(1);
});
