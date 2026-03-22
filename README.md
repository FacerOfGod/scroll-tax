# Monetize your friends addiction

> Turn screen-time guilt into crypto stakes. ScrollTax makes you and your group pay literally for doomscrolling.

ScrollTax is a **React Native** mobile app + **Telegram bot** that gamifies digital wellness through financial accountability. Spend too long on TikTok, Instagram, or any banned app? Your staked crypto gets automatically transferred to your friend.

---

## How it works

1. **Create or join a group** — stake XRP or use the Telegram bot to stake TON.
2. **Set your banned apps** — any app you want to scroll less on.
3. **ScrollTax watches** — a native Android Accessibility Service detects scroll events in real time.
4. **Get penalized** — exceed your threshold and a penalty payment fires automatically to the other members of the group.
5. **Win money** — The more your friends fail, the more money you make. But beware, the same goes for you.

---

## Platforms

| Platform | Status |
|---|---|
| Android app (React Native) | ✅ Supported |
| Telegram bot | ✅ Supported |
| iOS | ⚠️ Not supported (AccessibilityService is Android-only) |

---

## Blockchain support

ScrollTax supports two chains for staking and penalties:

### XRP Ledger (XRPL)
- Network: Testnet (`wss://s.altnet.rippletest.net:51233`)
- SDK: `xrpl` v4.6
- Wallet seeds stored securely via `react-native-keychain`
- The group creator's XRPL address acts as the group treasury

### TON (The Open Network)
- Native integration via the Telegram bot @scrolltaxbot
- TON wallets used for staking and penalty transactions within Telegram groups
- Enables zero-friction onboarding for Telegram-native users

---

## Tech stack

- **Frontend:** React Native 0.84.1 + TypeScript + React Navigation
- **Telegram bot:** TON-integrated bot for group creation and penalty tracking
- **Blockchain:** XRPL + TON
- **Backend:** Supabase (PostgreSQL + Auth + Row-Level Security)
- **Native (Android):** Kotlin `AccessibilityService` for real-time scroll detection
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

### Step 3: Enable the Accessibility Service

On your Android device, go to **Settings → App Usage** and enable the ScrollTax service to allow scroll detection on banned apps.

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
- If the penalty doesn't fire, make sure the Accessibility Service is enabled and the app is in your banned-apps list.
- If TON transactions fail with error 429, it is highly due to the TonCenter free plan limits.
