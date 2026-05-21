# Mobile Threat Model — Phase 2.2

This document captures the threat model the mobile app's keypair handling
is designed for. Re-read CLAUDE.md sections 7 and 8 alongside this file:
the rules there are non-negotiable; this file explains *why* this phase's
design satisfies them and what it explicitly does *not* defend against.

## What the Phase 2.2 design protects against

### Stolen but locked phone
- The Ed25519 private key on disk is encrypted with a 32-byte symmetric
  key derived from the user's 6-digit PIN (scrypt N=2^15, r=8, p=1) and
  a 16-byte random salt. The salt and the encrypted blob both live in
  `expo-secure-store`, which is iOS Keychain on iOS and Android Keystore
  on Android — backed by hardware on most modern devices. Without the
  PIN, the attacker has to either (a) extract the blob from the keystore
  (hardware-blocked on most devices) or (b) brute-force the PIN under
  scrypt cost.
- 5 wrong PINs → 5-minute lockout. 10 wrong PINs → keypair is wiped from
  the device, and the user must re-OTP. This caps attack throughput.

### Stolen but unlocked phone (briefly)
- After 5 minutes in the background, the app re-prompts for PIN. The
  in-memory decrypted private key is zeroed and dropped on lock or
  sign-out, so a thief who unlocks the device's screen lock still hits
  the PIN wall before they can sign anything.
- The PIN-derived symmetric key is regenerated from scratch on each
  unlock; it is never persisted.

### Lost phone
- The target recovery policy is now documented in
  `docs/key-recovery-policy.md`.
- Current implementation only partially supports that target:
  - the app stores the private key locally under the user's PIN
  - the backend stores one public key on the user record
  - replacing an existing public key requires a rotation signature from
    the old private key
  - when the user cannot produce that signature, the current app routes
    them to support
- The required target behavior is:
  - normal device move: old phone approves the new phone
  - lost phone: support-approved recovery creates a new ACTIVE key while
    keeping the old key as VERIFY_ONLY where safe
  - stolen/compromised phone: old key is blocked or REVOKED and affected
    payments go to review
  - old public keys must not be casually deleted, because already-scanned
    offline payments may still need verification
- Until device-key history and recovery requests are implemented,
  support must handle lost-device recovery conservatively and must not
  treat email OTP alone as authority to replace a payment key.

### Network interception
- All API traffic uses HTTPS via `apiClient`. The brief calls for SSL
  pinning (`react-native-ssl-pinning`); the stub for that lives in 2.5
  alongside top-up flows, since this phase doesn't add new endpoints
  beyond `/auth/keys/register`. No envelope material crosses the wire
  in 2.2.

### Offline boot fragility (regression from 2.1)
- A fetchMe NetworkError at boot no longer drops the user to "unauthed".
  We trust the existing token through one cache-miss and re-evaluate
  freshness on the next online operation. This means a user who opens
  the app with no signal gets the PIN entry screen, not a re-OTP demand.

## What the Phase 2.2 design does NOT protect against

### Rooted/jailbroken devices owned by the user
- A user with root can read the keystore directly. We don't try to
  defeat this; the user is attacking their own device.

### Sophisticated physical attackers with extraction tooling
- A nation-state-grade attacker with extraction hardware can pull the
  encrypted blob and brute-force a 6-digit PIN against scrypt. ~28 hours
  per million guesses on commodity hardware is *not* fast, but it is
  finite. We accept this for the pilot. Post-pilot mitigations:
  hardware-backed keypair (Secure Enclave / StrongBox), or moving to a
  longer passphrase.

### Compromised email accounts
- Email is the recovery channel. If the attacker controls the user's
  inbox, they can complete the OTP flow on a new device. The backend's
  `pubKeyRegistered` flag plus the rotation-signature requirement turns
  this from "instant takeover" into "needs support intervention," which
  is the current lost-key recovery path.
- The required target recovery policy is in
  `docs/key-recovery-policy.md`. Current code only partially implements
  that policy.

### Coercion / duress
- Out of scope. No duress PIN, no plausible-deniability mode.

## Specific design choices

### Why scrypt and not Argon2id?
- Mobile dependency landscape favors scrypt: `@noble/hashes/scrypt` is
  pure JS, audited, already a transitive dep via `@oneto/shared`. Argon2
  on Expo managed means either argon2-browser (WASM, larger bundle) or
  ejecting from managed for a native module.
- Wallet-ecosystem precedent: Ethereum keystore v3, Bitcoin BIP38, and
  most mobile wallets use scrypt for PIN/password-derived keys.
- At N=2^15 r=8 p=1, an attacker with a stolen blob takes ~28 hours per
  million guesses on commodity hardware — long enough to detect a missing
  phone and remote-wipe via lockout. Adequate for the pilot.

### Why no hardware-backed Ed25519 keypair yet?
- iOS Secure Enclave supports P-256 ECDSA, not Ed25519. Bridging Ed25519
  signing to a hardware-backed key requires either Ed25519 emulation in a
  Secure Enclave-resident worker (unsupported) or migrating the whole
  signature scheme to ECDSA P-256. Both are post-pilot.
- Android StrongBox / Keystore can hold an Ed25519 key on supported
  devices but coverage across CU students' phones is uneven. Post-pilot
  we'll evaluate per-platform fallback paths.

### Why no biometric unlock yet?
- Biometric is "convenience UX," not stronger crypto. The PIN is the
  authoritative secret; adding biometric in 2.2 would mean wrapping the
  PIN-derived key with another key gated by biometrics — strictly more
  attack surface for the same security budget. Defer until pilot data
  shows PIN entry as a real friction point.

### Why single-device only?
- Multi-device requires either a device-key sharing protocol (more crypto
  surface, more bugs) or a recovery-shard model. Both are post-pilot. The
  pilot's UX is "one phone per user"; reinstall = manual support.

### Why recovery is not just email OTP
- Email OTP proves inbox access. It does not prove control of the old
  Oneto payment device.
- A compromised email account must not be enough to replace the user's
  payment key. The backend's rotation-signature requirement prevents
  instant takeover when a user already has a registered key.
- The complete target policy is in `docs/key-recovery-policy.md`;
  user-facing copy is in `docs/key-recovery-user-copy.md`.

## Operational playbook references
- Current manual lost/stolen phone flow: user emails support@getoneto.com
  -> admin clears the user's `publicKey` in Prisma -> user re-onboards on
  the new device.
- Pre-pilot threat-model artifacts: `docs/threat-model.md`, `docs/failure-response.md`.
- Storage-layer rules: CLAUDE.md sections 7.1 (cryptographic rules) and
  8 (double-entry ledger).
