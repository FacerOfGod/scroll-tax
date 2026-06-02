# Monetize your friends addiction

> Turn screen-time guilt into crypto stakes. ScrollTax makes you and your group pay literally for doomscrolling.

ScrollTax is a **React Native** mobile app that gamifies digital wellness through financial accountability. Spend too long on TikTok, Instagram, or any banned app? Your staked crypto gets automatically transferred to your friends.

---

## How it works

1. **Create or join a group** — stake XRP with your friends.
2. **Set your banned apps** — any app you want to scroll less on.
3. **ScrollTax watches** — a native Android foreground service uses Usage Access to detect time spent in banned apps in real time.
4. **Get penalized** — exceed your threshold and a penalty payment fires automatically to the other members of the group.
5. **Win money** — The more your friends fail, the more money you make. But beware, the same goes for you.
6. **Bet on yourself** — stake against personal goals (GitHub, Strava, Chess.com, LeetCode) via Connected Accounts.

---

## Platforms

| Platform | Status |
|---|---|
| Android app (React Native) | ✅ Supported |
| iOS | ⚠️ Not supported (Usage Access detection is Android-only) |

---

## Blockchain support

### XRP Ledger (XRPL)
- Network: configurable via `XRPL_NETWORK` (`testnet` default, or `mainnet`); testnet is `wss://s.altnet.rippletest.net:51233`
- SDK: `xrpl` v4.6
- Wallet seeds stored securely via `react-native-keychain`
- The group creator's XRPL address acts as the group treasury
- Optional hardware-wallet signing via Ledger (BLE)

---

## Tech stack

- **Frontend:** React Native 0.84.1 + TypeScript + React Navigation
- **Blockchain:** XRPL
- **Backend:** Supabase (PostgreSQL + Auth + Row-Level Security + Edge Functions)
- **Native (Android):** Kotlin foreground service using Usage Access for real-time app detection
- **Secure storage:** `react-native-keychain`

---

## Getting started

> Make sure you have completed the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) before proceeding.

### Step 1: Start Metro

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

### Step 2: Run the app

**Android:**

```sh
npm run android
# OR
yarn android
```

**iOS** — not officially supported, but if you want to try:

```sh
bundle install
bundle exec pod install
npm run ios
```

### Step 3: Grant Usage Access

On your Android device, go to **Settings → App Usage** (or use the in-app prompt) and grant ScrollTax Usage Access so it can detect time spent in banned apps.

---

## Project structure

```
ScrollTax/
├── src/
│   ├── screens/
│   │   ├── auth/          # Login, Signup
│   │   ├── main/          # Dashboard, Groups, GroupDashboard, DistractionSettings
│   │   └── onboarding/    # Onboarding
│   └── services/          # XrplService, GroupService, SupabaseService
├── android/
│   └── app/src/main/java/com/scrolltax/   # Kotlin AccessibilityService
└── supabase/
    └── migrations/        # DB schema
```

---

## Troubleshooting

- [React Native Troubleshooting](https://reactnative.dev/docs/troubleshooting)
- If the penalty doesn't fire, make sure Usage Access is granted and the app is in your banned-apps list.
