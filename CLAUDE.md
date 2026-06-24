# CLAUDE.md — ScrollTax AI Context

> This file gives AI assistants (Claude Code, Cline, Cursor, etc.) the context
> they need to work efficiently in this codebase. Read this before touching code.

## Project Overview

**ScrollTax** is a React Native (Android-only) mobile app that gamifies digital
wellness through financial accountability on the **XRP Ledger (XRPL)**. Users
stake XRP (or in-app tokens) with friends and set "banned apps". A native
Android foreground service monitors app usage in real time; exceeding the
threshold triggers automatic penalty payments to group members.

**Version:** 1.0.2-beta  
**Platform:** Android only (iOS is not supported — Usage Access is Android-only)  
**Network:** XRPL testnet by default, mainnet opt-in via `XRPL_NETWORK=mainnet`

---

## Tech Stack

| Layer              | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Framework          | React Native 0.84.1 + TypeScript                             |
| Navigation         | React Navigation (Stack) v7                                   |
| Blockchain         | XRPL via `xrpl` SDK v4.6                                     |
| Hardware wallet    | Ledger Nano (BLE) via `@ledgerhq/hw-app-xrp`                 |
| Backend            | Supabase (PostgreSQL + Auth + RLS + Edge Functions)           |
| Native (Android)   | Kotlin foreground service (Usage Access API)                  |
| Secure storage     | `react-native-keychain` (wallet seeds)                        |
| Env vars           | `react-native-dotenv` → `@env` module                        |
| State              | React Context (`AuthContext`, `ThemeContext`)                  |
| Styling            | Inline `StyleSheet.create` — no CSS framework                 |

---

## Project Structure

```
scroll-tax/
├── index.js                    # Entry point — polyfills (Buffer, URL, crypto)
├── App.tsx                     # Root: GestureHandler → ErrorBoundary → RootNavigator
├── src/
│   ├── components/             # Reusable UI (ErrorBoundary, InAppNotification, Logo)
│   ├── context/
│   │   └── ThemeContext.tsx     # Dark/light toggle, persisted via AsyncStorage
│   ├── hooks/
│   │   └── useEntranceAnimation.ts
│   ├── navigation/
│   │   └── RootNavigator.tsx   # Auth-gated stack: Onboarding → Login/Signup → Main screens
│   ├── screens/
│   │   ├── auth/               # LoginScreen, SignupScreen
│   │   ├── main/               # Dashboard, Groups, GroupDashboard, CreateGroup,
│   │   │                       # DistractionSettings, CryptoGuide, SelfBets,
│   │   │                       # CreateSelfBet, ConnectedAccounts
│   │   └── onboarding/        # OnboardingScreen
│   ├── services/
│   │   ├── AuthContext.tsx     # Supabase auth + auto XRPL wallet provisioning
│   │   ├── GroupService.ts     # CRUD for groups & members, penalty RPCs, treasury ops
│   │   ├── XrplService.ts     # XRPL client (singleton), send/receive XRP, retry logic
│   │   ├── TreasuryService.ts # Custodial treasury: deposit → verify → ledger credit
│   │   ├── LedgerService.ts   # Ledger Nano BLE: scan, connect, sign XRP payments
│   │   ├── SelfBetService.ts  # Self-bets: GitHub/Strava/Chess.com/LeetCode goals
│   │   ├── ScrollDetectionService.ts  # NativeModule bridge to Kotlin service
│   │   ├── TokenService.ts    # In-app token balance (user_profiles table)
│   │   └── supabaseClient.ts  # Supabase client singleton
│   ├── theme/
│   │   └── colors.ts          # Colors (dark), LightColors, Gradients
│   ├── types/
│   │   ├── env.d.ts           # @env module declarations
│   │   └── navigation.ts     # MainStackParamList
│   └── utils/
│       └── penaltySplit.ts    # Drop-safe integer math for splitting penalties
├── android/app/src/main/java/com/scrolltax/
│   ├── ScrollDetectionModule.kt   # React Native ↔ Kotlin bridge
│   ├── ScrollDetectionService.kt  # Foreground service (Usage Access)
│   ├── ScrollDetectionPackage.kt  # RN package registration
│   ├── MainActivity.kt
│   └── MainApplication.kt
├── supabase/
│   ├── migrations/            # 15 sequential SQL migrations (init → treasury)
│   ├── functions/             # Edge functions: treasury, self-bet, connect-account,
│   │                          # join-group, verify-penalty-tx
│   ├── TREASURY.md            # Custodial treasury deploy & verify guide
│   └── reconcile-cron.sql     # Scheduled treasury reconciliation
└── scripts/                   # Treasury demo scripts, icon generator
```

---

## Key Commands

```bash
npm start                     # Start Metro bundler
npm run android               # Build and run on connected Android device/emulator
npm test                      # Run Jest tests
npm run lint                  # Run ESLint
```

---

## Architecture & Key Patterns

### Authentication Flow
1. Supabase Auth (email/password or Google OAuth)
2. On first sign-in, `AuthContext` auto-generates an XRPL wallet via `XrplService.generateWallet()`
3. Wallet seed stored in Android Keychain (`react-native-keychain`, keyed by `xrpl-{userId}`)
4. On testnet, wallet is auto-funded via faucet
5. Wallet address is persisted in `user_metadata.address` via `supabase.auth.updateUser()`

### Wallet Security
- **Seeds live in Keychain only** — never in Supabase, never in AsyncStorage
- Keychain service key: `xrpl-${userId}`
- The seed is passed to `ScrollDetectionService.setXrplSeed()` for HMAC-signing offline penalty queues

### Group / Penalty Flow
1. Creator creates a group → stakes XRP (sent to treasury or group wallet)
2. Members join → stake their own XRP
3. `ScrollDetectionService` (Kotlin foreground service) monitors banned app usage
4. When threshold exceeded → penalty fires:
   - Server-side: `record_penalty` RPC updates `group_members` (staked_amount ↓, penalties_incurred ↑)
   - Treasury mode: internal ledger redistribution (no per-penalty on-chain tx)
   - Client-to-peer mode: `XrplService.sendXrp()` with exponential backoff
5. Group end → `settleGroup()` edge function pays members back on-chain

### Treasury (Custodial)
- Single omnibus treasury account holds all group stakes
- `treasury_ledger` table tracks per-user balances internally
- Penalties redistribute ledger balances (no on-chain tx per penalty)
- Group settlement pays out on-chain from treasury
- Supports multisig payouts (`TREASURY_SIGNER_SEEDS`)
- See `supabase/TREASURY.md` for deploy instructions

### Self-Bets (Connected Accounts)
- Providers: GitHub (OAuth), Strava (OAuth), Chess.com (username), LeetCode (username)
- Users bet on personal goals (commits, runs, wins, solves)
- Edge function `self-bet` handles create/progress/settle
- Edge function `connect-account` handles OAuth exchange and username verification
- OAuth callbacks routed via `scrolltax://` deep links → `AuthContext.handleOAuthDeepLink()`

### Theme System
- `ThemeContext` provides `colors` object (dark/light)
- Persisted in AsyncStorage under `@theme`
- Color palette in `src/theme/colors.ts` — orange (#FF5300) primary
- All screens use `const {colors} = useTheme()` — no hardcoded colors in components

---

## Critical Gotchas

### Metro Bundler / XRPL
- `metro.config.js` has critical Node polyfill config — **do not remove `extraNodeModules`**
- `resolverMainFields: ['react-native', 'browser', 'main']` is required or Metro picks Node `ws` and hangs
- `unstable_enablePackageExports: false` prevents Metro from hanging on complex `exports` maps
- Custom `resolveRequest` rewrites `@ledgerhq/devices/*` → `@ledgerhq/devices/lib/*`

### Polyfill Import Order
- `index.js` MUST import polyfills **before** anything else:
  1. `react-native-get-random-values`
  2. `react-native-url-polyfill/auto`
  3. `buffer`
- `XrplService.ts` also sets `global.Buffer` — this is intentional

### XRPL Transaction Retry
- `XrplService.sendXrp()` retries on transient result codes (`telINSUF_FEE_P`, `tooBusy`, `terQUEUED`, `tefPAST_SEQ`, `terPRE_SEQ`)
- Exponential backoff: 1s, 2s, 4s
- Fatal codes (insufficient funds, bad destination) propagate immediately

### Penalty Math (Drop Safety)
- All XRP math in `penaltySplit.ts` uses **integer drops** (1 XRP = 1,000,000 drops)
- `splitDrops()` floors the per-recipient share; remainder goes to first recipient
- **Never use floating-point for XRP amounts** — use `xrpToDropsInt()` and `dropsToXrpString()`

### Supabase RLS
- `is_group_member()` uses `SECURITY DEFINER` to avoid infinite RLS recursion
- Group members can view all members in their groups (leaderboard)
- Only creators can update/delete groups
- Members can only insert/update/delete their own membership rows

### Deep Linking
- Scheme: `scrolltax://`
- Join group: `scrolltax://join/{groupId}` or `/join-group?group_id={id}`
- OAuth callbacks: `scrolltax://strava-callback`, `scrolltax://github-callback`, `scrolltax://auth-callback`
- Pending invites stored in AsyncStorage (`pendingJoinGroupId`) when unauthenticated

---

## Database Schema (Key Tables)

| Table              | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `groups`           | Group config: name, banned apps, penalty rules     |
| `group_members`    | Per-user stake, penalties, status in each group    |
| `user_profiles`    | In-app token balance                               |
| `self_bets`        | Self-bet records (provider, target, status)         |
| `connected_accounts` | OAuth/username links (GitHub, Strava, etc.)       |
| `treasury_ledger`  | Per-user held balance (drops) in custodial treasury|

Migrations are in `supabase/migrations/` — apply with `supabase db push`.

---

## Environment Variables

### Client-side (`.env`, bundled via `react-native-dotenv`)
| Variable           | Required | Description                              |
| ------------------ | -------- | ---------------------------------------- |
| `SUPABASE_URL`     | Yes      | Supabase project URL                     |
| `SUPABASE_ANON_KEY`| Yes      | Supabase anonymous key                   |
| `XRPL_NETWORK`     | No       | `testnet` (default) or `mainnet`         |
| `TREASURY_ADDRESS` | No       | Custodial treasury public address        |
| `HOUSE_WALLET`     | No       | Receives forfeited stakes                |
| `STRAVA_CLIENT_ID` | No       | Public Strava OAuth client ID            |

### Server-only (Supabase function secrets)
`TREASURY_SEED`, `TREASURY_SIGNER_SEEDS`, `TREASURY_ADMIN_SECRET`, `XRPL_RPC_URL`, `HOUSE_WALLET`

---

## Testing

```bash
npm test                      # Jest — react-native preset
```

- Test files live alongside source: `__tests__/` directories
- Existing tests: `ErrorBoundary.test.tsx`, `penaltySplit.test.ts`
- Jest setup: `jest.setup.js` (mock native modules)
- `transformIgnorePatterns` whitelists RN ecosystem ESM packages

---

## Coding Conventions

- **TypeScript** everywhere (except config files)
- **Services are singletons** — instantiated and exported at module level (e.g., `export const xrplService = new XrplService()`)
- **Supabase queries** return `{ data, error }` — always check `error` before using `data`
- **Error handling**: try/catch with `console.error`, return `{ data: null, error }` pattern
- **No CSS framework** — use `StyleSheet.create` with `useTheme()` colors
- **Env vars** accessed via `import { VAR } from '@env'` (typed in `env.d.ts`)
- **Prettier** config: `prettierrc.js` (trailing commas, single quotes)
- **ESLint**: extends `@react-native/eslint-config`
- **`patch-package`** runs on `postinstall` — check `patches/` before upgrading deps

---

## Service Singletons (Import Map)

```typescript
import { xrplService } from './services/XrplService';
import { groupService } from './services/GroupService';
import { treasuryService } from './services/TreasuryService';
import { ledgerService } from './services/LedgerService';
import { selfBetService } from './services/SelfBetService';
import { tokenService } from './services/TokenService';
import { supabase } from './services/supabaseClient';
import { ScrollDetectionService } from './services/ScrollDetectionService';
import { useAuth } from './services/AuthContext';
import { useTheme } from './context/ThemeContext';
```

---

## Android Native (Kotlin)

The scroll detection system is a **Kotlin foreground service** using Android's
UsageStatsManager API:

- `ScrollDetectionModule.kt` — React Native bridge (NativeModule)
- `ScrollDetectionService.kt` — Foreground service, polls usage stats
- `ScrollDetectionPackage.kt` — Package registration for RN

Required permissions: `PACKAGE_USAGE_STATS` (Usage Access), `SYSTEM_ALERT_WINDOW` (overlay)

---

## Common Tasks

### Adding a new screen
1. Create `src/screens/main/NewScreen.tsx`
2. Add to `MainStackParamList` in `src/types/navigation.ts`
3. Add `<Stack.Screen>` in `src/navigation/RootNavigator.tsx` (inside `{user ? ...}` block)

### Adding a new Supabase table
1. Create migration in `supabase/migrations/` (timestamp prefix)
2. Include RLS policies
3. Run `supabase db push`

### Adding a new service
1. Create `src/services/NewService.ts`
2. Export a singleton instance: `export const newService = new NewService()`
3. Use `supabase` client from `./supabaseClient` for DB operations

### Adding a new edge function
1. Create `supabase/functions/new-function/index.ts`
2. Deploy with `supabase functions deploy new-function`
3. Call from client: `supabase.functions.invoke('new-function', { body: {...} })`
