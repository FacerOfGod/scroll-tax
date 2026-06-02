# Custodial Treasury — deploy & verify

The custodial (omnibus) treasury holds all group XRP stakes in one backend
account, with a per-member internal ledger. Deposits go on-chain to the
treasury; penalties redistribute the ledger internally (no per-penalty tx);
group end pays each member their remaining balance back on-chain.

> **Status:** proven on testnet via the scripts below. The migrations are plain
> SQL; the edge function has **not** been deployed/run yet and needs the steps
> here. This is **not** a security-audited, production-ready custody system.

## Components

| Layer | Path |
|-------|------|
| Ledger schema + RPCs | `migrations/20260602000001_treasury_ledger.sql` |
| Penalty redistribution (in `record_penalty`) | `migrations/20260602000002_treasury_penalty_redistribution.sql` |
| Reconcile support (hash + index) | `migrations/20260602000003_treasury_reconciliation.sql` |
| Edge function (deposit / balance / payout / settle_group / reconcile) | `functions/treasury/index.ts` |
| Client | `src/services/TreasuryService.ts` |
| On-chain proofs | `scripts/treasury-testnet-demo.mjs`, `scripts/treasury-multisign-demo.mjs` |
| SignerList setup | `scripts/treasury-setup-signerlist.mjs` |
| Reconcile scheduling | `reconcile-cron.sql` |

## Secrets (function secrets — `supabase secrets set`)

| Name | Purpose |
|------|---------|
| `TREASURY_ADDRESS` | omnibus treasury account (also set as client `TREASURY_ADDRESS` env) |
| `TREASURY_SEED` | single-sign payouts (omit if using multisig) |
| `TREASURY_SIGNER_SEEDS` | comma-separated signer seeds for multisign payouts (≥ quorum) |
| `TREASURY_ADMIN_SECRET` | gates the `payout` and `reconcile` actions |
| `XRPL_RPC_URL` | XRPL JSON-RPC HTTP endpoint — **full-history node in production** |

## Deploy

```sh
# 1. apply migrations
supabase db push

# 2. create + fund the treasury account, then set secrets
supabase secrets set TREASURY_ADDRESS=r... XRPL_RPC_URL=https://...
supabase secrets set TREASURY_ADMIN_SECRET=$(openssl rand -hex 24)
#    single-sign:  supabase secrets set TREASURY_SEED=s...
#    OR multisig:  supabase secrets set TREASURY_SIGNER_SEEDS=s1,s2

# 3. set the public client env, then deploy the function
#    .env -> TREASURY_ADDRESS=r...
supabase functions deploy treasury

# 4. (multisig) install the SignerList on the treasury account
TREASURY_SEED=s... TREASURY_SIGNER_ADDRESSES=r1,r2,r3 \
  node scripts/treasury-setup-signerlist.mjs

# 5. (optional) schedule reconciliation — see reconcile-cron.sql
```

## Verify on testnet

```sh
node scripts/treasury-testnet-demo.mjs     # deposit -> treasury -> payout
node scripts/treasury-multisign-demo.mjs   # 2-of-3 multisig payout
```

End-to-end through the app (with `TREASURY_ADDRESS` set):
1. Create an XRP group → creator stake deposits to the treasury.
2. Second user joins → their stake deposits too. GroupDashboard balances read
   from `treasury_ledger`.
3. Trigger a penalty → offender's ledger balance drops, others' rise (no tx).
4. Creator ends the group → each member is paid their balance on-chain.

## Caveats

- **Reconcile needs a full-history XRPL node** (`XRPL_RPC_URL`); a pruning node
  could mis-read a validated-but-pruned payout as missing and re-credit it.
- The edge function imports `xrpl` from esm.sh — validate it in the edge runtime;
  fall back to `ripple-keypairs` + `ripple-binary-codec` if the bundle misbehaves.
- Production: split `TREASURY_SIGNER_SEEDS` across separate KMS/HSM stores and
  disable the treasury master key (`scripts/treasury-setup-signerlist.mjs`
  `DISABLE_MASTER=true`). Get a third-party audit before mainnet.
