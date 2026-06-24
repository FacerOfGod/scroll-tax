# Copilot Instructions — ScrollTax

> Instructions for GitHub Copilot, Cursor, and other AI code assistants.
> For the full project context, read `CLAUDE.md` in the repo root.

## Project

ScrollTax is a **React Native 0.84.1** (Android-only) app built with
**TypeScript**. It penalizes doomscrolling via **XRPL** crypto stakes. A Kotlin
foreground service monitors app usage; exceeding thresholds triggers on-chain
penalty payments.

## Stack

- React Native 0.84.1, TypeScript, React Navigation v7 (Stack)
- XRPL (`xrpl` v4.6), Ledger Nano BLE (`@ledgerhq/hw-app-xrp`)
- Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- Android: Kotlin foreground service (UsageStatsManager)
- Secure storage: `react-native-keychain`
- Env: `react-native-dotenv` → `import { VAR } from '@env'`

## Conventions

- Services are **singletons** exported at module level: `export const myService = new MyService()`
- Supabase calls return `{ data, error }` — always check `error`
- XRP amounts: **integer drops only** (1 XRP = 1,000,000 drops). Use `penaltySplit.ts` helpers
- Colors: use `const {colors} = useTheme()` — never hardcode color values
- Styles: `StyleSheet.create` — no CSS framework
- Wallet seeds: **Keychain only** (service: `xrpl-{userId}`), never in DB or logs
- Error returns: `{ data: null, error }` pattern from services
- New screens: add to `types/navigation.ts` → add `<Stack.Screen>` in `RootNavigator.tsx`
- Edge functions: `supabase/functions/{name}/index.ts`
- Migrations: `supabase/migrations/` with timestamp prefix, include RLS policies

## Do Not

- Remove or modify `metro.config.js` polyfill config (breaks XRPL)
- Change polyfill import order in `index.js`
- Use floating-point for XRP calculations
- Store wallet seeds anywhere except Android Keychain
- Hardcode colors — use `useTheme()` hook
- Skip RLS policies on new Supabase tables
