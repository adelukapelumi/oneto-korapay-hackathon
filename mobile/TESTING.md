# Mobile manual test checklist — Phase 2.1

This file is the manual smoke-test for the email-OTP sign-in flow. Run it on a real device (or simulator) before declaring 2.1 shipped. Unit tests cover logic; this checklist covers integration with the live backend, the OS, and the user.

## Prerequisites

1. Backend reachable at `https://oneto-production.up.railway.app/health` (returns `{"status":"ok"}`).
2. `mobile/.env` contains:
   ```
   EXPO_PUBLIC_API_URL=https://oneto-production.up.railway.app
   ```
3. Dependencies installed at the repo root: `pnpm install`.
4. `expo-cli` is **not** required — use `npx expo start` from `/mobile`.

## Booting the dev server

From `/mobile`:

```powershell
npx expo start --clear
```

`--clear` is important after any change to `.env`. Metro inlines `EXPO_PUBLIC_*` values at bundle time, so without a clear restart the old value persists in the served bundle. If you sign in and see a "Couldn't reach oneto" error pointing at a stale URL, this is why.

## Smoke checklist

Run each on iOS simulator AND Android emulator AND at least one physical device.

- [ ] App launches without a red-screen crash.
- [ ] Initial route: signed-out user lands on `/sign-in` (not a brief flash of `/home`).
- [ ] **Happy path:** enter `<your-real-email>` → tap "Send code" → email arrives within ~30 seconds → enter the 6-digit code → land on `/home`.
  - Home shows your email, role (`USER`), status (`ACTIVE`), and balance (`₦0.00` for a new account).
- [ ] **Form validation:** typing `abc` and tapping submit shows "That doesn't look like a valid email" and does not call the API.
- [ ] **Silent backend:** entering a syntactically valid but unregistered email (e.g., `nope+nonexistent@example.com`) still navigates to the verify screen. (The backend is intentionally silent on enumeration.)
- [ ] **Wrong code:** enter `000000` → see "Code didn't match. Try again." Input clears. No leak about whether the code expired vs. burned vs. wrong.
- [ ] **Persistence:** after a successful sign-in, kill the app fully (swipe up to close, force-stop on Android), reopen → land directly on `/home` without re-entering the OTP. The token survives.
- [ ] **Sign out:** tap "Sign out" on `/home` → routed to `/sign-in`. Reopening the app does not silently sign back in.
- [ ] **Airplane mode:** enable airplane mode. On `/sign-in`, tap "Send code" → see "Couldn't reach oneto. Check your connection." (NOT a stack trace, NOT a hang). On `/verify`, the same.
- [ ] **Resend cooldown:** on `/verify`, the "Resend code" link is disabled and shows "Resend code in Ns" for 30 seconds after entering the screen. After it counts down, tapping it sends a new code.
- [ ] **Auto-submit:** typing the 6th digit of the code automatically triggers verification (no need to tap Verify).
- [ ] **Numeric-only OTP input:** non-numeric keys are silently dropped. Pasting `12 34 56` produces `123456`.
- [ ] **Stale token:** in a SQL or admin tool, manually flip the user's `status` to `FROZEN` and reload `/home` (kill-relaunch). The next API call returns 403; for now this presents as "loading → unauthed → /sign-in" because we don't yet handle 403 specifically. Note this in `POST_PILOT.md` if it surprises a CU.

## Known gotchas

- **Changing `.env` requires `npx expo start --clear`.** EXPO_PUBLIC_* values are inlined into the bundle at build time. A warm Metro will keep serving the old values.
- **iOS simulator + expo-secure-store:** works on SDK 52+, but you may see a warning about Keychain access groups in the dev console. Safe to ignore for the pilot; on real devices it has no warning.
- **Android emulator + localhost:** if you ever point `EXPO_PUBLIC_API_URL` at a local backend, use `10.0.2.2` (Android's alias for the host loopback), not `localhost`. The pilot URL is the deployed Railway one, so this only matters for offline backend dev.
- **expo-router redirect loops:** if you see the screen flash between `/sign-in` and `/home`, the auth gate logic in `app/(auth)/_layout.tsx` and `app/(app)/_layout.tsx` got desynced from `auth-state.ts`. The fix is always: render `null` or a spinner during `status === "loading"` instead of redirecting.

## What's intentionally not covered here

- Keypair generation, QR scan, offline payments — Phase 2.2+.
- Push notifications, biometric unlock, refresh tokens — post-pilot.
- SSL pinning — comes with the production hardening pass before launch.
