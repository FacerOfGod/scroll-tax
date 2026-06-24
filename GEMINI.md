# Gemini AI Context — ScrollTax

> Context file for Google Gemini (Gemini Code Assist, Antigravity, etc.).
> See also: `CLAUDE.md` for the full canonical AI context document.

## Quick Summary

**ScrollTax** — React Native 0.84.1 (Android-only) app that penalizes
doomscrolling with XRPL crypto stakes. Users form groups, stake XRP, set banned
apps, and a Kotlin foreground service auto-charges penalties when thresholds are
exceeded. Also supports self-bets against personal goals (GitHub, Strava,
Chess.com, LeetCode).

## Stack

- **Frontend:** React Native 0.84.1 + TypeScript + React Navigation v7 (Stack)
- **Blockchain:** XRPL (testnet default) via `xrpl` v4.6 SDK
- **Hardware wallet:** Ledger Nano (BLE) via `@ledgerhq/hw-app-xrp`
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Native:** Kotlin foreground service (UsageStatsManager API)
- **Secure storage:** `react-native-keychain` (wallet seeds)
- **Env vars:** `react-native-dotenv` → `import { VAR } from '@env'`
- **Themes:** `ThemeContext` with dark/light toggle, orange (#FF5300) primary

## Key Files

| Purpose                  | Path                                          |
|--------------------------|-----------------------------------------------|
| Entry + polyfills        | `index.js`                                    |
| Root component           | `App.tsx`                                     |
| Navigation               | `src/navigation/RootNavigator.tsx`            |
| Auth & wallet provisioning | `src/services/AuthContext.tsx`              |
| XRPL client              | `src/services/XrplService.ts`                |
| Group CRUD + penalties   | `src/services/GroupService.ts`                |
| Treasury (custodial)     | `src/services/TreasuryService.ts`            |
| Ledger Nano BLE          | `src/services/LedgerService.ts`              |
| Self-bets                | `src/services/SelfBetService.ts`             |
| Scroll detection bridge  | `src/services/ScrollDetectionService.ts`     |
| Token balance            | `src/services/TokenService.ts`               |
| Colors / theme           | `src/theme/colors.ts`                        |
| Nav types                | `src/types/navigation.ts`                    |
| Penalty math (drops)     | `src/utils/penaltySplit.ts`                  |
| Kotlin service           | `android/app/src/main/java/com/scrolltax/`   |
| DB migrations            | `supabase/migrations/`                       |
| Edge functions           | `supabase/functions/`                        |

## Commands

```bash
npm start          # Metro bundler
npm run android    # Build & run
npm test           # Jest tests
npm run lint       # ESLint
```

## Critical Rules

1. **Polyfill order in `index.js`**: `react-native-get-random-values` → `react-native-url-polyfill/auto` → `buffer`. Must come before all other imports.
2. **Metro config**: Do NOT remove `extraNodeModules` or change `resolverMainFields` in `metro.config.js` — XRPL will break.
3. **Wallet seeds**: Stored in Android Keychain only. Never in Supabase, AsyncStorage, or logs.
4. **XRP math**: Always use integer drops (1 XRP = 1,000,000 drops). See `penaltySplit.ts`. Never use floating-point for amounts.
5. **Services are singletons**: Instantiated at module level, e.g., `export const xrplService = new XrplService()`.
6. **Theme colors**: Always use `const {colors} = useTheme()` — never hardcode colors.
7. **Supabase RLS**: `is_group_member()` is `SECURITY DEFINER` to avoid recursive RLS. Test any new policies carefully.
8. **Deep link scheme**: `scrolltax://` — used for group invites and OAuth callbacks.
9. **`patch-package`**: Runs on `postinstall` — check `patches/` before upgrading dependencies.

## Patterns

- **Error handling**: `{ data, error }` return pattern from all service methods
- **Screen creation**: Add to `MainStackParamList` in `types/navigation.ts`, then add `<Stack.Screen>` in `RootNavigator.tsx`
- **New services**: Singleton class, exported instance, uses `supabase` from `./supabaseClient`
- **New edge functions**: `supabase/functions/{name}/index.ts`, deploy with `supabase functions deploy {name}`

## Database (Key Tables)

`groups`, `group_members`, `user_profiles`, `self_bets`, `connected_accounts`, `treasury_ledger`

## Env Vars

**Client** (`.env`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `XRPL_NETWORK`, `TREASURY_ADDRESS`, `HOUSE_WALLET`, `STRAVA_CLIENT_ID`

**Server** (Supabase secrets): `TREASURY_SEED`, `TREASURY_SIGNER_SEEDS`, `TREASURY_ADMIN_SECRET`, `XRPL_RPC_URL`

---

*For the full detailed context document, see `CLAUDE.md`.*
