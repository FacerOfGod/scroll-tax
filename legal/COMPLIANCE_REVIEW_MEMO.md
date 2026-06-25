# ScrollTax — Compliance Review Memo (for counsel)

> **Purpose:** Brief a qualified attorney so the gambling / money-transmitter /
> AML and security-audit reviews can be scoped quickly. This memo is written by
> the engineering side to describe **how the product actually works**. It is
> **not legal advice** and reaches **no legal conclusions** — it frames the
> questions that need professional answers before any real-money (mainnet)
> launch.

**Prepared:** [DATE] · **Prepared by:** [NAME] · **Product:** ScrollTax (Android)

---

## 1. One-paragraph product description

ScrollTax is an Android digital-wellness app. Users set commitments — either
**screen-time limits** on chosen apps (enforced by an on-device foreground
service reading Android Usage Access) or **personal goals** verified via
third-party APIs (GitHub commits, Strava runs, Chess.com wins, LeetCode solves).
Users back commitments with a **stake** of XRP (XRP Ledger) or an in-app token.
Failing a commitment causes the stake (or part of it) to be **redistributed to
other group members** or **forfeited** (a configurable "house" wallet may receive
forfeited amounts). The product targets **real-money mainnet** operation;
currently it runs on **testnet** (no monetary value).

## 2. Money-movement mechanics (facts for classification)

1. **Wallets:** Each user gets a non-custodial XRPL wallet; the seed is stored
   only on the user's device (Android Keychain). We never hold it.
2. **Custodial treasury:** For group/self-bet flows the app also operates a
   **pooled, custodial omnibus treasury account** plus an **internal ledger**
   (`treasury_ledger`, balances in XRP drops). Users **deposit** into the
   treasury; we **hold** their balance; we **pay out** on settlement.
3. **Penalties:** When a user fails, their treasury balance is **debited
   internally** and credited to other members' internal balances — typically
   **no on-chain transaction per penalty**.
4. **Settlement:** At group end (or self-bet win), the treasury pays out
   on-chain to users' wallets.
5. **Forfeits:** A self-bet **loss** keeps the staked funds in the treasury /
   house wallet (no payout). A configurable `HOUSE_WALLET` may receive forfeited
   stakes — i.e. **the operator may profit from losses**.
6. **Token path:** A parallel in-app token (no on-chain value) mirrors the
   mechanic for users who don't stake XRP.

## 3. Questions for counsel (the actual review)

### 3.1 Gambling / gaming law
- Does staking money on **your own behavioral outcome** (screen time / personal
  goals) constitute **gambling** in the target jurisdictions? Classic tests turn
  on **consideration + chance + prize**. Key facts to weigh: outcomes are
  largely **skill/effort-based and self-determined**, but money can flow **from
  one user to another** and **to the operator** (house wallet).
- Does redistribution **between users** change the analysis vs. a pure
  self-forfeit? Does an operator cut (`HOUSE_WALLET`) create a "stake against the
  house" or "the house profits" problem?
- Are these "**contests of skill**", "**prediction/peer-to-peer wagering**", or
  "**commitment/deposit-contract**" products under each target jurisdiction's
  rules? Which framing is defensible, and what disclosures/structure are required
  to stay in it?
- Which **jurisdictions must be geo-blocked** outright?

### 3.2 Money transmission / e-money / custody
- By **holding pooled user funds in a custodial treasury** and **paying out**,
  do we become a **money transmitter / money services business (MSB)** (US
  state-by-state + FinCEN), an **e-money / payment institution** (EU/UK), or a
  **crypto-asset service provider (CASP)** under MiCA?
- Does moving funds **between users** (penalty redistribution) trigger transmE
  licensing even if much of it is internal-ledger only?
- What **safeguarding / segregation** rules apply to held customer funds?
- Does issuing the **in-app token** create separate regulatory exposure?

### 3.3 AML / KYC / sanctions
- At what point do we need a **KYC/identity** program, transaction monitoring,
  SAR/STR reporting, and a designated compliance officer?
- **Sanctions screening:** the app currently has **no KYC and no sanctions
  screening**. What is the minimum viable program for mainnet?
- Travel-rule applicability to XRPL transfers we facilitate?

### 3.4 Consumer protection, tax, data
- Required **risk disclosures** (volatility, irreversibility, total-loss,
  custody risk) — are the draft Terms §6 sufficient?
- **Tax**: do payouts/winnings create reporting obligations for us or users?
- **Data protection**: confirm the draft Privacy Policy's lawful bases, the
  Usage-Access consent flow, international-transfer safeguards (Supabase/Sentry
  regions), and age limits given staking. GDPR/UK GDPR/CCPA scope?
- **Age**: minimum age for staking money (likely 18+) and how to enforce it.

### 3.5 Entity & contracts
- What **legal entity / jurisdiction** should operate this, and what does that
  imply for the above? Processor agreements (DPAs) with Supabase/Sentry in place?

## 4. Known technical risk items feeding the legal picture

These are engineering facts counsel should know; several are also open
pre-launch blockers:
- **Custody keys** (`TREASURY_SEED`, signer seeds) are currently **plaintext
  function secrets** — no KMS/HSM. Multisig + master-key-disable enforcement is
  coded behind a flag but **key material is not yet hardware-protected**.
- **No third-party security audit** has been performed. Recommended **before**
  holding real customer funds. Scope should include: treasury edge functions,
  signing path, Supabase RLS, the reconcile/settlement state machine, and the
  Android monitoring service.
- **Edge functions / migrations not yet deployed or end-to-end tested** on a live
  environment.
- **No KYC, no sanctions screening, no geo-blocking** implemented today.
- Reconcile requires a **full-history XRPL node** in production (guard exists) to
  avoid wrong re-credit/double-spend.

## 5. Recommended sequencing

1. **Counsel determines classification** (§3.1–3.2) → this decides whether the
   product can launch as-is, needs restructuring, needs licensing, or must
   geo-block markets. *Everything else depends on this answer.*
2. Based on classification, scope **KYC/AML/sanctions** program (§3.3).
3. Finalize **Privacy Policy / Terms** with counsel; implement the consent and
   deletion flows.
4. Commission the **third-party security audit**; remediate findings.
5. Harden **custody** (KMS/HSM, enforce multisig, disable master key).
6. Only then enable **mainnet**.

## 6. Attachments

- Draft [Privacy Policy](./PRIVACY_POLICY.md)
- Draft [Terms of Service](./TERMS_OF_SERVICE.md)
- [Play Store declarations](./PLAY_STORE_DECLARATIONS.md)
- Technical: `supabase/TREASURY.md`, `CLAUDE.md`, treasury edge functions under
  `supabase/functions/`.
