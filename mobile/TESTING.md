# Mobile manual test checklist — Phase 2.1

This file is the manual smoke-test for the email-OTP sign-in flow. Run it on a real device (or simulator) before declaring 2.1 shipped. Unit tests cover logic; this checklist covers integration with the live backend, the OS, and the user.

## Prerequisites

1. Backend reachable at `https://api.getoneto.com/health` (returns `{"status":"ok"}`).
2. `mobile/.env` contains:
   ```
   EXPO_PUBLIC_API_URL=https://api.getoneto.com
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

- [✔] App launches without a red-screen crash.
- [✔ ] Initial route: signed-out user lands on `/sign-in` (not a brief flash of `/home`).
- [✔] **Happy path:** enter `<your-real-email>` → tap "Send code" → email arrives within ~30 seconds → enter the 6-digit code → land on `/home`.
  - Home shows your email, role (`USER`), status (`ACTIVE`), and balance (`₦0.00` for a new account).
- [✔] **Form validation:** typing `abc` and tapping submit shows "That doesn't look like a valid email" and does not call the API.
- [✔] **Silent backend:** entering a syntactically valid but unregistered email (e.g., `nope+nonexistent@example.com`) still navigates to the verify screen. (The backend is intentionally silent on enumeration.)
- [✔] **Wrong code:** enter `000000` → see "Code didn't match. Try again." Input clears. No leak about whether the code expired vs. burned vs. wrong.
- [✔] **Persistence:** after a successful sign-in, kill the app fully (swipe up to close, force-stop on Android), reopen → land directly on `/home` without re-entering the OTP. The token survives.
- [✔] **Sign out:** tap "Sign out" on `/home` → routed to `/sign-in`. Reopening the app does not silently sign back in.
- [✔] **Airplane mode:** enable airplane mode. On `/sign-in`, tap "Send code" → see "Couldn't reach oneto. Check your connection." (NOT a stack trace, NOT a hang). On `/verify`, the same.
- [✔] **Resend cooldown:** on `/verify`, the "Resend code" link is disabled and shows "Resend code in Ns" for 30 seconds after entering the screen. After it counts down, tapping it sends a new code.
- [✔] **Auto-submit:** typing the 6th digit of the code automatically triggers verification (no need to tap Verify).
- [✔] **Numeric-only OTP input:** non-numeric keys are silently dropped. Pasting `12 34 56` produces `123456`.
- [-] **Stale token:** in a SQL or admin tool, manually flip the user's `status` to `FROZEN` and reload `/home` (kill-relaunch). The next API call returns 403; for now this presents as "loading → unauthed → /sign-in" because we don't yet handle 403 specifically. Note this in `POST_PILOT.md` if it surprises a CU.

## Known gotchas

- **Changing `.env` requires `npx expo start --clear`.** EXPO_PUBLIC_* values are inlined into the bundle at build time. A warm Metro will keep serving the old values.
- **iOS simulator + expo-secure-store:** works on SDK 52+, but you may see a warning about Keychain access groups in the dev console. Safe to ignore for the pilot; on real devices it has no warning.
- **Android emulator + localhost:** if you ever point `EXPO_PUBLIC_API_URL` at a local backend, use `10.0.2.2` (Android's alias for the host loopback), not `localhost`. The current default points at the deployed backend, so this only matters for offline backend dev.
- **expo-router redirect loops:** if you see the screen flash between `/sign-in` and `/home`, the auth gate logic in `app/(auth)/_layout.tsx` and `app/(app)/_layout.tsx` got desynced from `auth-state.ts`. The fix is always: render `null` or a spinner during `status === "loading"` instead of redirecting.

## What's intentionally not covered here

- Keypair generation, QR scan, offline payments — Phase 2.2+.
- Push notifications, biometric unlock, refresh tokens — post-pilot.
- SSL pinning — comes with the production hardening pass before launch.

---

# Phase 2.2 manual checklist — keypair, PIN, offline-aware boot

Run on iOS simulator AND Android emulator AND at least one physical device.
Reset secure-store between runs (uninstall+reinstall on a real device, or
"Erase All Content" in the simulator).

- [ ] **First-time setup:** brand-new email → OTP → land on welcome →
      tap Continue → enter 6-digit PIN → re-enter same PIN to confirm →
      "Generating keypair…" → "Securing PIN…" → "Registering with oneto…" →
      land on `/home`. Balance shows ₦0.00.
- [ ] **PIN mismatch during setup:** enter `123456`, then on confirm
      enter `111111` → see "PINs don't match. Try again." Input clears
      and step resets to "enter".
- [ ] **Returning user:** kill app → reopen → land on `/(locked)/pin-entry`.
      Enter correct PIN → land on `/home` without re-OTP.
- [ ] **Wrong PIN 5 times:** enter `999999` five times → see "Locked.
      Try again in 5:00." Countdown decrements each second.
- [ ] **Wait 5 min, retry:** after countdown reaches 0, the input
      becomes editable again. Correct PIN unlocks. Counter remembers
      the previous 5 failures (no fresh 5-attempt allowance until
      the wipe at 10).
- [ ] **Wrong PIN 10 total:** five more wrong attempts after lockout
      expires → keypair is wiped → bounced to `/(auth)/sign-in`.
      Reopening the app starts a fresh first-time setup flow.
- [ ] **Change PIN:** on `/home`, tap "Change PIN" → enter old PIN +
      new PIN twice → see "PIN changed." → returns to home. Kill app
      → reopen → unlock with the NEW PIN. Old PIN now fails.
- [ ] **Background app for 6 minutes, return:** put app in background
      while on `/home`, wait 6+ minutes, foreground → land on
      `/(locked)/pin-entry`. Decrypted private key was wiped from memory.
- [ ] **Background app for 30 seconds, return:** put app in background,
      wait 30s, foreground → still on `/home`, no PIN re-prompt.
- [ ] **Offline boot:** enable airplane mode, kill app, reopen → land
      on `/(locked)/pin-entry` (NOT bounced to email entry). Correct PIN
      unlocks → land on `/home` with the warning banner "Sign in again
      to top up or see your latest balance."
- [ ] **Lost-key path:** clear secure-store on a device that already
      has a registered public key (or use a new physical device with the
      same email account) → after OTP and PIN setup, the
      `/auth/keys/register` call fails with `rotation_signature_required`.
      The "We need to verify it's you" screen shows with the
      support@getoneto.com address. Contacting support unblocks the
      account in Prisma.
- [ ] **JWT freshness banner:** sign in successfully → use Prisma to
      flip the user's status, or wait until the 30-day JWT expires (not
      practical) → home screen shows the orange "Sign in again…" banner
      and the balance card swaps to "Last known balance — sign in again
      to refresh." Top-up button (when added in 2.5) will be disabled.
- [ ] **Sign out from locked:** on `/(locked)/pin-entry`, tap "Sign in
      with a different account" → bounced to `/(auth)/sign-in`. Token
      cleared; keypair left on disk for next sign-in attempt.

## Known gotchas (2.2-specific)

- **scrypt is intentionally slow.** PIN entry on a mid-range Android
  device takes ~200-500ms. The "generating keys" screen takes 1-2
  seconds. This is correct: we want each guess to cost something.
- **Background lock uses RN AppState, not setTimeout.** A timer would
  not survive the app being suspended. The lock check fires on
  resume by comparing the recorded "backgrounded at" timestamp.
- **Decrypted private key never enters React state.** It lives in a
  `useRef` so it doesn't show up in component snapshots, devtools, or
  state-restoration paths. `getDecryptedPrivateKey()` reads the ref
  directly.
