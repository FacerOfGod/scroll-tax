# Google Play — Declarations & Data Safety (ScrollTax)

> Operational guide for the Play Console submission. Copy/paste the justification
> text below into the relevant Console sections. Everything here is grounded in
> the app's actual manifest and code. **Verify each item against the build you
> submit** — Play rejects mismatches between declared and actual behavior.

---

## 1. Sensitive / special permissions to declare

The app requests permissions Google treats as sensitive. Each needs an in-Console
justification and a matching in-app disclosure + runtime consent.

### 1.1 Usage Access — `PACKAGE_USAGE_STATS` (App usage / "Special app access")
- **Where:** `AndroidManifest.xml:8`. Granted by the user via
  Settings → Special app access → Usage access (not a normal runtime prompt).
- **Why we need it:** Core feature. We read foreground app usage to detect when a
  user exceeds a screen-time threshold they configured, which triggers the
  accountability penalty. The feature does not function without it.
- **Prominent disclosure (required):** Before sending the user to the Usage
  Access settings screen, show an in-app disclosure: *"ScrollTax needs Usage
  Access to monitor how long you use the apps you've chosen to limit, so it can
  enforce your screen-time stakes. This data is processed on your device; we do
  not upload your full app-usage history."* The user must affirmatively continue.
- **Data Safety mapping:** "App activity → App interactions / other in-app
  actions." Processed on device; not sold; used for app functionality.

### 1.2 Display over other apps — `SYSTEM_ALERT_WINDOW`
- **Where:** `AndroidManifest.xml:16`.
- **Why:** Draw a warning overlay (red border) on top of a banned app when the
  user is over threshold. Justify as core to the accountability UX.

### 1.3 Foreground service (special use) — see Section 2.

### 1.4 Bluetooth + `ACCESS_FINE_LOCATION`
- **Where:** `AndroidManifest.xml:17-24`. `BLUETOOTH_SCAN` is flagged
  `neverForLocation`; `ACCESS_FINE_LOCATION` is `maxSdkVersion`-bounded in spirit
  (needed for BLE scan on Android ≤ 11).
- **Why:** Optional Ledger Nano **hardware-wallet** connection over Bluetooth LE.
- **Declare:** Location is **not** used to derive user location — only to satisfy
  the legacy Android BLE-scan requirement. State this in the permissions
  declaration form to avoid a location-policy rejection.

### 1.5 Others (normal, no special declaration)
`INTERNET`, `POST_NOTIFICATIONS` (runtime prompt on Android 13+),
`RECEIVE_BOOT_COMPLETED` (restart monitoring after reboot),
`FOREGROUND_SERVICE`.

---

## 2. Foreground Service Type declaration (REQUIRED)

The app declares `foregroundServiceType="specialUse"`
(`AndroidManifest.xml:57`) with subtype property
(`AndroidManifest.xml:62-64`). Apps targeting Android 14+ (this app targets
SDK 36) that use a foreground service **must declare the FGS type in Play
Console** and justify `specialUse` specifically.

**Console → App content → Foreground service permissions / FGS type — paste:**

> **Service:** `com.scrolltax.ScrollDetectionService`
> **Type:** Special Use
> **Justification:** ScrollTax is a screen-time accountability app. The service
> runs a continuous foreground task that polls Android's `UsageStatsManager` to
> determine, in real time, whether the user has exceeded the screen-time limits
> they set for specific apps, and to enforce the financial stake tied to those
> limits. Continuous operation is essential because accountability must hold
> whenever the user is on their phone, including immediately after unlock or
> reboot. No other foreground service type matches this use case: it is not media
> playback, location, data sync, camera, microphone, phone call, connected
> device, health, or remote messaging. The `dataSync` type is unsuitable because
> it is time-capped (~6h/day on Android 15+), which would silently disable
> accountability for the rest of the day.

**Why not `dataSync`:** documented inline at `AndroidManifest.xml:10-13`.

> ⚠️ `specialUse` is reviewed case-by-case and Google may still reject it. Have a
> fallback plan (e.g. `WorkManager`/`AlarmManager` periodic checks) if rejected.

---

## 3. Data Safety form (Play Console → App content → Data safety)

Fill the form to match actual behavior. Suggested mapping (verify before submit):

| Data type | Collected? | Shared? | Purpose | Notes |
|-----------|-----------|---------|---------|-------|
| Email address | Yes | No | Account management | Via Supabase Auth |
| User IDs | Yes | No | Account management | Wallet **public** address; appears on public blockchain |
| Financial info (other) | Yes | No | App functionality | Stakes/penalties/treasury ledger; on-chain tx are public |
| App activity (app interactions) | Yes | No | App functionality | Usage Access; processed on device, penalty events stored |
| App info & performance (crash logs, diagnostics) | Yes (if Sentry on) | Yes (to Sentry) | Analytics / app functionality | PII off; seeds/secrets redacted |
| Other (connected-account tokens/usernames) | Yes (optional) | No | App functionality | GitHub/Strava tokens; Chess.com/LeetCode usernames |
| **Precise location** | **No** | No | — | `ACCESS_FINE_LOCATION` is for BLE scan only, `neverForLocation` |

**Security practices to declare:**
- Data encrypted in transit: **Yes**.
- Users can request deletion: **Yes** (provide the in-app/contact path — Play
  requires a working deletion mechanism + a public deletion URL).
- Wallet private keys are stored only on-device (not collected by us).

**Account deletion URL (required if accounts exist):** [PUBLIC DELETION URL].

---

## 4. Privacy Policy URL (REQUIRED)

Play requires a **publicly hosted** privacy policy URL (not a file in the repo).
Host [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) at a stable URL and enter it in
Console → App content → Privacy policy. Keep it reachable for the app's lifetime.

---

## 5. Financial / "real money" considerations for Play

Because the app moves real value and may be construed as wagering/contests:
- Review **Google Play's Real-Money Gambling, Games, and Contests policy** and
  the **Financial services / Crypto** policies. Eligibility, country
  availability, and licensing requirements may apply. **This is a launch
  blocker until counsel confirms classification** (see the compliance memo).
- If any feature is classified as gambling, Play has a separate
  application/approval process and strict country gating.
- Crypto-exchange/wallet functionality may require additional declarations.

---

## 6. Pre-submission checklist

- [ ] Privacy Policy hosted at a public URL and entered in Console
- [ ] Terms of Service published (link in-app + store listing)
- [ ] Account-deletion path implemented in-app + public deletion URL
- [ ] Data Safety form completed to match the shipped build
- [ ] FGS `specialUse` declaration submitted with justification (Section 2)
- [ ] Usage Access prominent-disclosure screen implemented and shown pre-grant
- [ ] Location-permission declaration states BLE-only / `neverForLocation`
- [ ] Real-money/gambling & crypto policy eligibility confirmed with counsel
- [ ] Target audience / age rating set (likely 18+ given staking)
- [ ] Obfuscated (R8) release build smoke-tested end-to-end
