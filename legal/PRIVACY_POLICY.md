# ScrollTax — Privacy Policy

> **STATUS: DRAFT — requires review by a qualified attorney before publication.**
> Placeholders in `[BRACKETS]` must be filled in. This document was drafted from
> the app's actual data flows (Android manifest, edge functions, services) but is
> **not legal advice** and may not satisfy every applicable law (GDPR, UK GDPR,
> CCPA/CPRA, etc.). Have counsel confirm scope, lawful bases, and disclosures.

**Effective date:** [EFFECTIVE DATE]
**Last updated:** [DATE]
**Data controller:** [LEGAL ENTITY NAME] ("ScrollTax", "we", "us")
**Contact:** [PRIVACY CONTACT EMAIL] · [POSTAL ADDRESS]
**EU/UK representative (if applicable):** [NAME / "Not applicable"]
**Data Protection Officer (if applicable):** [NAME / "Not applicable"]

---

## 1. Who we are and what this covers

ScrollTax is an Android-only mobile application that helps people enforce
digital-wellness goals through financial accountability on the XRP Ledger
(XRPL). This policy explains what personal data we collect, why, how we share
it, how long we keep it, and the rights you have.

This policy covers the ScrollTax app and its backend (hosted on Supabase). It
does **not** cover the XRP Ledger itself (a public blockchain we do not operate)
or third-party services you choose to connect (GitHub, Strava, Chess.com,
LeetCode), each of which has its own privacy policy.

## 2. Important notice about the blockchain

ScrollTax records value transfers on the **XRP Ledger, a public and immutable
blockchain**. Transactions — including wallet addresses, amounts, and
timestamps — are **permanent, public, and outside our control**. We cannot
edit, hide, or delete on-chain data. Do not put information you wish to keep
private into the blockchain, and understand that your wallet address may be
linkable to your activity by anyone.

## 3. Data we collect

### 3.1 Data you provide
| Data | Purpose | Where stored |
|------|---------|--------------|
| Email address & password (or Google sign-in identity) | Create and secure your account | Supabase Auth |
| Group names, stake amounts, penalty rules, group membership | Run accountability groups | Supabase (Postgres) |
| "Banned apps" list and screen-time thresholds you configure | Enforce your screen-time commitments | On device; thresholds synced to enable monitoring |
| Self-bet goals (e.g. target commits/runs/wins/solves) | Run "bet on yourself" challenges | Supabase |

### 3.2 Data created for you (wallet)
On first sign-in the app generates an **XRPL wallet** for you.
- The **wallet seed (private key)** is stored **only in the device's secure
  Android Keychain** (key `xrpl-<your user id>`). **We never transmit, log, or
  store your seed on our servers.** If you lose your device without backing up
  the recovery key, we **cannot** recover your funds.
- Your **wallet public address** is stored in your account profile and on group
  records so penalties and payouts can be routed, and it appears publicly on the
  XRP Ledger.

### 3.3 App-usage data (Usage Access)
With your permission (Android Usage Access / `PACKAGE_USAGE_STATS`), a
foreground service reads **which apps are in the foreground and for how long**,
to detect when you exceed a threshold you set.
- This monitoring runs **on your device**. We do **not** upload your full
  app-usage history to our servers.
- When a threshold is exceeded, we record the resulting **penalty event**
  (which group, amount, timestamp) on our backend to redistribute stakes.
- You can revoke Usage Access at any time in Android Settings; monitoring then
  stops.

### 3.4 Connected accounts (optional, for self-bets)
If you connect a third-party account we store what's needed to verify your goal:
| Provider | What we obtain | Stored |
|----------|----------------|--------|
| GitHub (OAuth) | Access token; your GitHub login; commit counts in the bet window | `connected_accounts` |
| Strava (OAuth) | Access + refresh tokens; athlete id/username; run counts in the window | `connected_accounts` |
| Chess.com | The username you supply; public win totals | `connected_accounts` |
| LeetCode | The username you supply; public solve totals | `connected_accounts` |

We request the **minimum** scope needed to count the relevant metric. You can
disconnect a provider at any time, which removes the stored link/token.

### 3.5 Financial / ledger data
We maintain an internal **custodial treasury ledger** recording your held
balance (in XRP "drops") and a transaction audit trail (deposits, penalties,
payouts, settlements). On-chain transaction hashes are stored to reconcile
payments.

### 3.6 Diagnostics (crash reporting)
If enabled, we use **Sentry** to capture crash and error reports so we can fix
bugs. We configure Sentry with **PII disabled** and a scrubber that **redacts
wallet seeds and any secret-like values** before transmission. Crash data may
include device model, OS version, and a stack trace.

### 3.7 Collected automatically
Standard technical data needed to operate the service: IP address (seen by our
backend/host), timestamps, and basic device/OS information.

### 3.8 Data we do **not** collect
We do not collect precise GPS location. The `ACCESS_FINE_LOCATION` permission is
requested **only** to satisfy Android's requirement for **Bluetooth LE scanning**
(used to connect an optional Ledger hardware wallet) on Android 11 and below; the
scan is flagged `neverForLocation` and we do not derive your location from it.

## 4. Why we use your data (purposes & legal bases)

Where GDPR/UK GDPR applies, our legal bases are:
- **Performance of a contract** (Art. 6(1)(b)) — operating your account, groups,
  stakes, penalties, and payouts.
- **Consent** (Art. 6(1)(a)) — Usage Access monitoring, connecting third-party
  accounts, and optional diagnostics. You may withdraw consent at any time.
- **Legitimate interests** (Art. 6(1)(f)) — security, fraud/abuse prevention,
  debugging, and service improvement, balanced against your rights.
- **Legal obligation** (Art. 6(1)(c)) — if we become subject to financial,
  tax, AML/KYC, or other regulatory requirements. *(Pending legal review — see
  the compliance memo.)*

## 5. How we share data

We do **not** sell your personal data. We share it only with:
- **Service providers (processors):** Supabase (database, auth, hosting),
  Sentry (diagnostics, if enabled), and our cloud infrastructure providers.
- **Third-party APIs you connect:** GitHub, Strava, Chess.com, LeetCode — only
  to verify the goals you set.
- **The XRP Ledger:** transaction data is published to a public blockchain.
- **Other users in your groups:** your display identity, wallet address, stake,
  and penalty counts are visible to fellow group members (leaderboard).
- **Legal/safety:** to comply with law, enforce our Terms, or protect rights and
  safety.

## 6. International transfers

Our providers may process data outside your country (e.g. in the United States
or the EU). Where required, transfers rely on appropriate safeguards such as
Standard Contractual Clauses. [CONFIRM PROVIDER REGIONS & SAFEGUARDS WITH COUNSEL.]

## 7. Retention

We keep account and financial-ledger data for as long as your account is active
and as needed to provide the service, resolve disputes, and meet legal/record-
keeping obligations. **On-chain transactions cannot be deleted.** Crash reports
are retained per Sentry's retention settings. [CONFIRM SPECIFIC PERIODS.]

## 8. Your rights

Depending on where you live (e.g. EEA/UK under GDPR, California under CCPA/CPRA),
you may have the right to access, correct, delete, port, restrict, or object to
processing of your data, to withdraw consent, and to lodge a complaint with a
supervisory authority. California residents have the right not to receive
discriminatory treatment for exercising these rights, and we do not sell or
"share" personal information for cross-context behavioral advertising.

To exercise rights, contact **[PRIVACY CONTACT EMAIL]**. We will respond within
the timeframe the law requires. Note: we **cannot** delete data already written
to the public blockchain, and we cannot recover a wallet seed we never held.

## 9. Account & data deletion

You can request account deletion at **[PRIVACY CONTACT EMAIL]** [or in-app at
[LOCATION] — implement an in-app deletion path; Google Play requires one]. We
will delete or anonymize your backend personal data subject to legal retention
and the immutability of on-chain records.

## 10. Security

Wallet seeds are held only in the device Keychain. Backend access is governed by
row-level security and authenticated APIs; treasury operations are restricted to
server-side keys. No method of transmission or storage is 100% secure. **A
third-party security audit is recommended before mainnet launch and is not yet
complete.**

## 11. Children

ScrollTax is **not directed to children under [16/13 — confirm per jurisdiction]**
and we do not knowingly collect their data. Because the app involves staking
money on outcomes, additional age restrictions may apply (see Terms).

## 12. Changes

We may update this policy. Material changes will be notified in-app or by email.
The "Last updated" date reflects the current version.

## 13. Contact

[LEGAL ENTITY NAME]
[POSTAL ADDRESS]
[PRIVACY CONTACT EMAIL]
