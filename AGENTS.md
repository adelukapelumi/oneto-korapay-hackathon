# AGENTS.md — oneto Project Context

This file is the source of truth for any AI coding assistant (Codex, Antigravity, Cursor, Copilot) working on oneto. Read it in full before making changes. Re-read the relevant section before any non-trivial edit. If anything in this file conflicts with a user instruction, stop and ask — do not silently override.

---
## 0. Required reading before any change

Before touching code, every AI agent must:
1. Read this entire AGENTS.md
2. Read `.agents/rules/oneto-project-rules.md`
3. Run `git status` and understand the current state
4. Read `/shared/src/index.ts` to understand shared types
5. If touching `/backend/`, read `/backend/src/app.module.ts` to see wired modules
6. If touching security-critical folders (crypto, auth, reconcile, balance), read AGENTS.md sections 6, 7, 8 again immediately before starting

Do not skip any of these. If skipped, you will make decisions inconsistent with the project's architecture.

## 0.5 Current implementation state

Snapshot of what exists vs what's planned. Update this section when major components are added, removed, or change status. When in doubt about whether something is "real," this section is the source of truth.


### Built and tested

Backend feature-complete. Live at https://oneto-production.up.railway.app.

- `/shared` package: Ed25519 signing/verification, deterministic canonicalization, TransactionEnvelope schema with red-team tests. 16 tests passing.
- `/backend/src/common/phone.ts`: libphonenumber-js-based normalization for Nigerian mobile numbers. Used as the E.164 branded type (currently also repurposed for email OTP target keys until a rename).
- `/backend/src/common/email.ts`: zod-based email normalization (lowercase + trim + format validation).
- `/backend/src/common/user-throttler.guard.ts`: custom NestJS guard that keys rate limits by JWT subject (user-id) instead of IP, with IP fallback when no auth context. Used on financially-sensitive routes.
- `/backend/src/auth/otp-store.service.ts`: in-memory OTP store with Argon2 hashing, burn-after-3-fails, TTL expiry, email-keyed rate limiting, periodic cleanup via setInterval lifecycle hook. 25 tests passing.
- `/backend/src/auth/auth.service.ts`: email OTP flow (request + verify), user upsert on first successful verify, status gating for FROZEN and FLAGGED accounts, ADMIN role blocked from public OTP login (silent success to prevent enumeration), JWT issuance. 27+ tests passing.
- `/backend/src/auth/merchant-auth.service.ts` + `/backend/src/auth/merchant-auth.controller.ts`: separate merchant signup flow with MerchantProfile (cashoutBankCode + cashoutBankName + account details), in-memory stash with TTL during OTP verification, role=MERCHANT and status=PENDING_VERIFICATION on activation. 12 tests passing.
- `/backend/src/auth/keys.controller.ts`: public key registration with first-time bootstrap and signed rotation for replacement (Option A — strict replacement). 6 tests passing.
- `/backend/src/topup/`: Korapay checkout initiation + webhook handler. Webhook handler now (a) verifies HMAC-SHA256 signature on raw payload, (b) validates payload against KorapayWebhookSchema (Zod) — rejects malformed, (c) inside Serializable transaction: debits u_operating + credits user (Ghost Money fix), enforces MAX_USER_BALANCE_KOBO regulatory cap (FAILED PaymentTopup recorded if exceeded), creates double-entry ledger rows. Idempotent via unique constraint on PaymentTopup.reference. Throws InternalServerErrorException on transaction failure to trigger Korapay retries (does not silently swallow). 23 tests passing.
- `/backend/src/topup/korapay-webhook.schema.ts`: Zod schema validating Korapay webhook payload structure. Uses `unknown` at boundary, narrowed inside service.
- `/backend/src/reconcile/`: reconcile endpoint with merchant role enforcement, public key registration with signed rotation, Serializable Prisma transactions, per-user sequence uniqueness via ProcessedSequence table, identity binding (envelope recipient must match authenticated user), recipient balance cap enforcement (rejected with internal reason `recipient_balance_cap_exceeded`, generic external `invalid_envelope`), generic external errors prevent oracle attacks, sanitized rejection logs (only transactionId + senderUserId + recipientUserId + reason + amountKobo, never signature/publicKey/sequenceNumber/balances). 28 tests passing.
- `/backend/src/cashout/`: manual admin approval flow. `approveCashout` and balance reservation merged into single atomic Serializable transaction (status PENDING→PROCESSING + merchant balance decrement + u_operating credit + double-entry ledger entries all atomic). Conditional UPDATE prevents race condition between concurrent admins. Korapay Payout API call fired AFTER transaction commits. Compensating ledger entries on Korapay failure. transfer.success/failed webhook handling with event/status spoofing protection. 32 tests passing.
- `/backend/src/me/`: GET /me profile endpoint, GET /me/ledger with cursor pagination (max 100/page, BigInt-as-string serialization). 11 tests passing.
- `/backend/src/health/health.controller.ts`: GET /health returning {"status":"ok"} for uptime monitoring (UptimeRobot pings every 5 min).
- `/backend/src/instrument.ts` + Sentry integration: production error capture via @sentry/nestjs SDK. Wraps all uncaught exceptions with stack traces and request context. Free tier sufficient for pilot.
- `/backend/src/main.ts`: helmet middleware sets HTTP security headers (HSTS, nosniff, X-Frame-Options, CSP, etc.) before any route handler.
- `/backend/src/app.module.ts`: global IP-keyed throttler (100 req/min default) as defense-in-depth layer above per-user limits on sensitive endpoints. Per-route throttle decorators: /reconcile (20/min/user), /cashout/request (5/min/user), /cashout/approve/:id (30/min/user). SentryGlobalFilter registered as APP_FILTER.
- Prisma schema: User, LedgerEntry, PaymentTopup, ProcessedSequence, MerchantProfile, Cashout models. Compound unique constraint `@@unique([transactionId, userId])` on LedgerEntry prevents double-spend at the database layer.
- Email infrastructure: `getoneto.com` domain verified with SPF + DKIM. Real emails delivering to CU inboxes instantly.

Total: 170 backend tests + 16 shared tests = 186 tests passing.

Three independent security audit rounds completed. Seven audit fixes shipped:
1. Ghost Money fix (top-up debits u_operating, restoring system invariant)
2. Webhook 500 on transaction failure (no silent swallowing of errors)
3. ADMIN role blocked from public OTP login
4. Reconcile rejection logs sanitized (no signature/key/sequence leakage)
5. Cashout race condition fixed (atomic conditional UPDATE)
6. Cashout atomicity fix (status transition + balance reservation merged into single transaction)
7. MAX_USER_BALANCE_KOBO regulatory cap enforced in topup and reconcile
8. Per-user rate limiting on sensitive endpoints
9. Zod validation replaces `any` types in webhook + reconcile + keys controller paths
10. Helmet security headers middleware

### Stubbed (route exists, throws NotImplementedException)

(none — backend feature-complete)

### Stubbed

(none — backend feature-complete)

### NEW UPDATE
- Mobile app (React Native / Expo) — keypair generation, QR scan, local SQLite ledger, offline-first UI. Phase 2 in ROADMAP.

### Not yet built
- Admin dashboard (user management, cashout approvals queue, fraud review). Phase 3 in ROADMAP. Pilot can survive with API-only access plus Prisma Studio for emergencies.
- Lost-key recovery flow (email-based confirmation with cooling-off period). Currently requires admin manual intervention to clear an old public key when a user reinstalls the app. Documented in POST_PILOT.md.

### Known limitations of current state

- OTP store is in-memory. Crashes lose all active OTP records. Acceptable for single-instance pilot. Documented as Redis migration item in POST_PILOT.md.
- ThrottlerModule storage is in-memory. Single-instance pilot is fine; horizontal scaling requires Redis-backed throttler.
- JWT secret lives in Railway env var. No rotation strategy yet (deferred — implement before scaling beyond pilot).
- Clock skew tolerance in `/shared` is 120s. Offline envelopes ship with 60s expiry.
- Transaction ID is 64-bit truncated SHA-256. Safe for pilot scale.
- No automated lost-key recovery — currently a manual admin process. Described in POST_PILOT.md.
- Reconcile flow is unidirectional (merchant submits). Phantom-sync for offline merchants (where we proactively push reconciled state to a merchant who can't reach the network) is post-pilot.
- Daily invariant cron not yet running. Currently can be checked manually with: SUM all user balances + u_operating balance should equal 0.

### Deferred to post-pilot

See `/POST_PILOT.md` at repo root for the full list. High-level categories: Redis-backed OTP and throttler storage, licensed NIN/BVN verification, PSSP/MMO license pursuit, professional penetration test, Google Workspace for team email, end-to-end integration tests with a real test database, lost-key recovery flow, daily invariant cron, branded Email type rename, multi-device support.

### How to use this section

When an AI agent says "I'll add X" or an audit flags "Y is missing," check this section first. If something is listed as "built and tested," it's real — go audit the code. If it's "stubbed" or "not yet built," that's an intentional TODO, not a bug. If you make something new real, move it from the "not yet built" list to "built and tested" and update the relevant test counts.

## 1. What oneto is

oneto is an offline-capable payment system piloting at Covenant University, Nigeria. The core feature: two phones can complete a payment without internet, using cryptographically signed QR codes, with later reconciliation to a central server.

**Legal structure for the pilot:** closed-loop prepaid program. Students buy credits with naira, spend credits only at participating merchants, merchants cash out weekly. This is not an MMO and not e-money under CBN rules. The closed-loop structure is **load-bearing** — if code enables student-to-student credit transfers or student cashouts, it breaks the legal basis of the entire operation.

**Mental model:** oneto is a Starbucks-style gift card program with offline payment capability, not a wallet or a bank.

---

## 2. The developer's profile and working style

The primary developer is a junior engineer, final-year university student, solo founder. This changes how AI assistants should work:

- **Explain before you implement.** Non-trivial code, especially anything security-critical, must include inline comments and a brief explanation of why, not just what.
- **Prefer readable over clever.** Choose the boring solution the developer can debug at 2 a.m. six months from now.
- **Flag assumptions.** If you are guessing at intent, say so. Never silently pick a reasonable-sounding default on anything security-related.
- **Never silently rewrite working code.** If you see something you would do differently, mention it once and ask before refactoring.
- **Threat-model proactively.** Before writing any feature that touches money, keys, or user data, list the three most likely ways an attacker could exploit it. Design against those explicitly.
- **Admit when you don't know.** For regulatory questions, crypto edge cases, or anything involving real-world consequences, say "I am not certain; verify with a lawyer / a senior engineer / the official documentation."

---

## 3. Architecture overview

### 3.1 High-level components

- **Mobile app (React Native + Expo, TypeScript):** user-facing app for students and merchants. Contains signing logic, local SQLite ledger, QR generation and scanning.
- **Backend (NestJS, TypeScript):** REST API handling authentication, reconciliation, merchant cashouts, admin operations.
- **Database (PostgreSQL, managed):** source of truth for verified balances, transaction history, user records.
- **Payment rails (Korapay):** handles naira-in (student top-ups) and naira-out (merchant cashouts). oneto never handles raw card data.

### 3.2 Trust boundaries — memorize these

- The phone is **partially trusted**. Phones can be rooted, apps can be modified. Never trust balance or sequence numbers from the client alone.
- The server is **fully trusted** and is the source of truth for verified balances.
- Transaction envelopes are **cryptographically trusted** once their Ed25519 signature is verified against the user's server-registered public key.
- The signed envelope is the authoritative record of intent. Database rows are derived from it, not the other way around.

### 3.3 The transaction lifecycle

1. **Top-up (online):** Student pays naira via Korapay. Server verifies webhook signature. Server increments the student's `verifiedBalanceKobo`. Two ledger rows written.
2. **Offline payment:** Merchant generates a payment request QR (amount + merchant ID + nonce). Student scans, confirms, the student's app constructs and signs a transaction envelope, displays the signed envelope as a second QR. Merchant scans the signed envelope and verifies the signature locally. Both phones store the envelope in their local SQLite ledgers as `pending_reconciliation`.
3. **Reconciliation:** The merchant (recipient) submits pending envelopes to `/reconcile` when online. Server verifies signature, confirms the authenticated user matches `recipientUserId` in the envelope, checks that `senderSequenceNumber` has not been used before (per-user uniqueness, NOT strict monotonic ordering — envelopes may arrive out of order from different merchants), checks current server balance is sufficient to cover the debit, writes double-entry ledger rows in a Serializable transaction, updates both users' `verifiedBalanceKobo`.
4. **Merchant cashout:** Merchant requests cashout via app. Admin reviews (manual during pilot). Korapay Transfer API sends naira to the merchant's bank account. Operating account debited in the ledger.


### NEW UPDATE TO TRANSACTION CYCLE (NOT YET IMPLEMENTED)
2. **Offline payment:** When student wants to pay, the student clicks the pay button and a list of merchants pre-registered will show up, the student clicks on the merchant they want to pay to and then the amount of money they want to pay and then their PIN to confirm then a QR code will be generated with the merchant's ID and the amount to be paid Then the merchant will scan the QR code and confirm the payment. 

---

## 4. Technology stack — exact versions and why

Lock these in `package.json`. Do not upgrade casually. Security-critical libraries get version pins, not ranges.

### 4.1 Mobile (`/mobile`)

- **React Native** via **Expo SDK 52+** — managed workflow for faster iteration. Eject only if absolutely necessary. Both iOS and Android supported from day one.
- **TypeScript** in strict mode (`strict: true`). No `any` types in security-critical paths.
- **expo-secure-store** — for storing Ed25519 private keys. Uses iOS Keychain and Android Keystore under the hood. Never use AsyncStorage for secrets.
- **expo-sqlite** — local ledger storage on device.
- **expo-camera** — QR scanning (preferred over expo-barcode-scanner which is being deprecated).
- **react-native-qrcode-svg** — QR generation.
- **tweetnacl** + **tweetnacl-util** — Ed25519 signing and verification. Audited, small, portable across iOS and Android.
- **@tanstack/react-query** — server state, caching, retry logic.
- **zustand** — local UI state (not for sensitive data).
- **react-hook-form** + **zod** — form validation with schema types.
- **react-native-ssl-pinning** — certificate pinning for API calls.

### 4.2 Backend (`/backend`)

- **NestJS 10+** with TypeScript, strict mode.
- **PostgreSQL 15+** via managed provider (Neon, Supabase Postgres, or Railway Postgres).
- **Prisma** as ORM. Better DX and type safety than TypeORM for a junior dev. Migrations are enforced and version-controlled.
- **@nestjs/config** with `zod` validation on env vars. Fail loudly at boot if env is invalid.
- **@nestjs/throttler** — rate limiting on all public endpoints.
- **bullmq** + **Redis** (Upstash for managed Redis) — reconciliation queue, retries, async jobs.
- **pino** — structured JSON logging. Never `console.log` in production code.
- **class-validator** + **class-transformer** — request DTO validation on every endpoint.
- **@nestjs/jwt** — JWT session tokens for mobile clients. Short-lived.
- **argon2** — password hashing if we ever need it. Prefer OTP over passwords.
- **@noble/ed25519** — signature verification on the backend.

### 4.3 Infrastructure

- **Hosting:** Railway or Render for pilot. Not raw AWS — too easy to misconfigure.
- **Auth:** Email + OTP via Resend (CU bans SIMs on campus; SMS not viable). Phone is optional and highly recommended for merchants. No passwords for end users.
- **Payments:** Korapay for top-ups and cashouts. Verify all webhooks via HMAC signature.
- **Monitoring:** Sentry for errors, Axiom or Logtail for logs, UptimeRobot for heartbeat checks.
- **Secrets:** Doppler or Infisical for environment variable management. Never commit `.env` files. Never paste secrets into Codex or Antigravity prompts.

### 4.4 Forbidden choices and why

- **MongoDB or any non-ACID database for ledger data.** Serializable transactions are required for balance updates.
- **bcrypt for password hashing.** Argon2id is the modern choice.
- **JWT-based revocation-free sessions longer than 24 hours.** Use short-lived access tokens with rotation.
- **Storing private keys in AsyncStorage, SharedPreferences, or any non-secure storage.** Non-negotiable.
- **Rolling your own crypto.** Ever. Including hash functions, signature schemes, or "just a simple XOR." Never.
- **`any` type in TypeScript for transaction, balance, or key-related code.** Use precise types or `unknown` with narrowing.
- **Floating-point numbers for money.** Integer kobo only, always.

---

## 5. Repository structure

```
oneto/
├── AGENTS.md                        this file
├── README.md                        human-facing quickstart
├── mobile/                          React Native Expo app
│   ├── app/                         expo-router screens
│   ├── src/
│   │   ├── crypto/                  keypair, signing, verification — CRITICAL
│   │   ├── ledger/                  local SQLite ledger
│   │   ├── qr/                      QR encode/decode
│   │   ├── api/                     backend client with SSL pinning
│   │   ├── screens/
│   │   ├── components/
│   │   └── types/
│   └── __tests__/
├── backend/                         NestJS API
│   ├── src/
│   │   ├── auth/                    OTP login
│   │   ├── users/                   user accounts, public keys
│   │   ├── balance/                 verified balance management
│   │   ├── reconcile/               envelope verification and ledger writes — CRITICAL
│   │   ├── topup/                   Korapay webhook handler
│   │   ├── cashout/                 merchant cashout flow
│   │   ├── admin/                   admin dashboard endpoints
│   │   └── common/                  shared utilities, guards, filters
│   ├── prisma/
│   │   └── schema.prisma
│   └── test/
├── shared/                          code shared between mobile and backend
│   ├── types/                       TransactionEnvelope, branded types
│   └── schemas/                     zod schemas
└── docs/
    ├── threat-model.md              before launch: list attacks and defenses
    ├── failure-response.md          detect, contain, recover playbook
    └── regulatory-notes.md          closed-loop legal structure documentation
```

**Security-critical folders:** `/mobile/src/crypto`, `/backend/src/reconcile`, `/backend/src/balance`. All changes to these folders require a matching unit test, a commit-message explanation of the change, and a manual review.

---

## 6. Core data structures

These types live in `/shared/types/` and are imported by both mobile and backend. They must never drift between the two sides.

```typescript
// Currency is always integer kobo. 1 naira = 100 kobo. Never use floats for money.
export type Kobo = number & { readonly __brand: 'Kobo' };
export const toKobo = (n: number): Kobo => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid kobo value: ${n}`);
  }
  return n as Kobo;
};

export type UserId = string & { readonly __brand: 'UserId' };      // "u_" + 16 hex
export type TransactionId = string & { readonly __brand: 'TxId' }; // "tx_" + 16 hex
export type MerchantId = UserId;

export type PublicKey = string;   // "ed25519:" + 64 hex chars
export type Signature = string;   // "ed25519:" + 128 hex chars

export interface TransactionEnvelope {
  version: 1;
  transactionId: TransactionId;
  senderUserId: UserId;
  senderPublicKey: PublicKey;
  recipientUserId: UserId;
  amountKobo: Kobo;
  senderSequenceNumber: number;        // monotonic per user, starts at 1
  senderBalanceBeforeKobo: Kobo;
  senderBalanceAfterKobo: Kobo;
  timestamp: string;                   // ISO 8601 UTC
  expiresAt: string;                   // ISO 8601 UTC, timestamp + 60s
  requestNonce: string;                // from merchant's request QR
  signature: Signature;
}
```

**Invariants that must always hold:**
- `transactionId` is SHA-256 of canonical JSON of all other fields (without `signature`), truncated to 16 hex chars.
- `senderBalanceAfterKobo === senderBalanceBeforeKobo - amountKobo`. Verify at sign time (mobile). Server does NOT require these to match server-side balance at reconcile time — the server computes its own authoritative balance after each debit and credit. The envelope's balance fields are the sender's claim at signing time; out-of-order reconciliation means they may not match server state.
- `amountKobo > 0`.
- `amountKobo <= MAX_OFFLINE_TRANSACTION_KOBO` (currently `200_000` = ₦2,000). Constant lives in `/shared/types/limits.ts`.
- `senderSequenceNumber` is unique per-sender across all time. The server tracks all consumed sequence numbers and rejects re-use. Envelopes may arrive out of order and still be processed.

---

## 7. Cryptographic rules — read every time you touch this code

### 7.1 Hard rules

1. **Never roll your own crypto.** Always use `tweetnacl` (mobile) or `@noble/ed25519` (backend).
2. **Never store, log, or transmit a private key.** Private keys live in `expo-secure-store` on device and nowhere else. They must never appear in logs, crash reports, or error messages.
3. **Never accept an unsigned message as authoritative.** If it is not signed and verified, it is client state, not truth.
4. **Always verify signatures against the server-registered public key** for that user. The public key embedded in the envelope must match the registered one; a mismatch is a rejection.
5. **Canonicalize before signing.** Sort JSON keys alphabetically, no whitespace, UTF-8 encoding. Use the same canonicalization function on both client and server. Live in `/shared/canonicalize.ts`.
6. **Timestamps must be verified.** Reject envelopes with `expiresAt` in the past. Reject envelopes with `timestamp` more than 120 seconds in the future (clock skew tolerance).
7. **Constant-time comparison for signatures.** Use `nacl.sign.detached.verify` or `crypto.timingSafeEqual` — never `===`.
8. **Public key rotation policy (pilot):** When a user re-registers a new public key, the old key is immediately replaced. Any envelopes signed with the old key that have not yet been reconciled will be rejected. Users are warned in-app to complete pending transactions before reinstalling. Post-pilot: multiple active keys per user with explicit revocation.

### 7.2 Signing flow (mobile)

```typescript
// See /mobile/src/crypto/sign.ts for actual implementation
function signEnvelope(
  draft: Omit<TransactionEnvelope, 'signature'>,
  privateKey: Uint8Array
): TransactionEnvelope {
  // Validate invariants BEFORE signing
  assertInvariants(draft);

  const canonical = canonicalizeJson(draft);
  const messageBytes = new TextEncoder().encode(canonical);
  const signatureBytes = nacl.sign.detached(messageBytes, privateKey);
  return { ...draft, signature: `ed25519:${toHex(signatureBytes)}` };
}
```

### 7.3 Verification flow (backend)

```typescript
// See /backend/src/reconcile/verify.ts for actual implementation
function verifyEnvelope(
  envelope: unknown,
  registeredPublicKey: PublicKey
): VerifyResult {
  // 1. Check envelope shape via zod schema. Reject if shape invalid.
  // 2. Check envelope.senderPublicKey === registeredPublicKey.
  // 3. Check timestamp freshness (within 120s clock skew tolerance) and expiry.
  // 4. Check amountKobo > 0 and <= MAX_OFFLINE_TRANSACTION_KOBO.
  // 5. Check envelope self-consistency: balanceAfter === balanceBefore - amount.
  // 6. Canonicalize envelope without signature field.
  // 7. Verify Ed25519 signature using constant-time comparison.
  // 8. Check senderSequenceNumber has not already been consumed (anti-replay).
  // 9. Check server's authoritative balance for sender >= amountKobo (anti-overdraft).
  // 10. Check authenticated user ID === envelope.recipientUserId (identity binding).
  // 11. Return { ok: true } or { ok: false, reason: "..." }.
  // Run all 11 checks. Log which one failed for debugging, but return
  // a generic "invalid envelope" to the client to avoid oracle attacks.
}
```

---

## 8. The double-entry ledger

### 8.1 Schema (Prisma)

```prisma
model LedgerEntry {
  id              String           @id @default(cuid())
  transactionId   String           // groups debit+credit of same transaction
  userId          String
  type            LedgerEntryType  // DEBIT or CREDIT
  amountKobo      BigInt
  balanceAfterKobo BigInt          // user's balance after this entry
  description     String
  envelopeJson    Json?            // full envelope for TX entries; null for admin ops
  createdAt       DateTime         @default(now())

  user            User             @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
  @@index([transactionId])
}

enum LedgerEntryType {
  DEBIT
  CREDIT
}
```

### 8.2 Rules

- **Every money-moving operation writes exactly two rows in a single DB transaction.** One debit, one credit. Sum across the system is always zero.
- **Rows are never updated or deleted.** Only inserted. To reverse a transaction, insert compensating entries with `description: "REVERSAL of tx_..."`.
- **`balanceAfterKobo` is computed server-side, never accepted from client.** The client's `senderBalanceAfterKobo` field in the envelope is what the client CLAIMS; the server computes what is TRUE.
- **Serializable isolation for reconciliation transactions.** Prisma: `$transaction([...], { isolationLevel: 'Serializable' })`. This prevents race conditions where two concurrent reconciliations both read a stale balance.

### 8.3 The operating account

A single internal user record with `id: "u_operating"` represents oneto's operating float. Every top-up credits this account (money came in from Korapay) and credits the student (they now have credits). Every cashout debits the operating account (we paid naira out) and debits the merchant (their credits are gone). The sum of all non-operating account balances always equals the negative of the operating account's balance.

**Run the invariant check daily:** `SUM(all user balances) + operating_account_balance === 0`. If this is ever false, pause the system and investigate. Do not allow any new transactions until the mismatch is resolved.

---

## 9. API surface

All endpoints return JSON. All require auth except where noted. All log structured events to Axiom.

```
POST  /auth/otp/request             public        send OTP to phone
POST  /auth/otp/verify              public        verify OTP, return session JWT
POST  /auth/keys/register           auth          register device public key

GET   /me                           auth          profile + verifiedBalanceKobo
GET   /me/ledger                    auth          paginated transaction history

POST  /topup/Korapay/initiate      auth          returns Korapay checkout URL
POST  /topup/Korapay/webhook       public+HMAC   handles payment completion

POST  /reconcile                    auth          submit pending envelopes
POST  /reconcile/status             auth          check envelope statuses

POST  /cashout/request              auth/merchant request cashout
GET   /cashout/status               auth/merchant check cashout status

GET   /merchants/search             auth          lookup merchant by ID for payment

POST  /admin/cashout/approve        auth/admin
GET   /admin/reconciliation-report  auth/admin    daily float invariant check
POST  /admin/user/:id/flag          auth/admin
POST  /admin/user/:id/freeze        auth/admin
```

Every endpoint has:
- A zod schema for request and response
- A NestJS DTO with `class-validator` decorators
- At least one e2e test in `/backend/test/`
- Rate limiting configured via `@Throttle` decorator

---

## 10. Coding standards

### 10.1 TypeScript

- `strict: true` in both tsconfigs. No exceptions.
- No `any`. Use `unknown` for genuinely unknown, then narrow with zod or type guards.
- No non-null assertions (`!`) on security-critical paths. Check and throw.
- Prefer `readonly` for data that should not mutate.
- Use branded types for `UserId`, `TransactionId`, `Kobo` to prevent accidental mixups.

### 10.2 Error handling

- Never swallow errors silently. Log, then rethrow or return a structured error.
- User-facing errors: generic messages. Never expose stack traces or internal state.
- Internal errors: full context logged to Sentry with request ID.
- Every error has a `code` field (string enum) and optionally a `hint` for the user.

### 10.3 Testing

- **Security-critical paths** (crypto, reconcile, balance): unit tests required, 90% minimum coverage, every branch tested.
- **Other paths:** integration tests on endpoints required.
- **E2E:** happy-path flows for top-up, payment, reconciliation, cashout.
- **Red-team tests:** for each security boundary, write a test that tries to break it — bad signature, replayed envelope, expired envelope, negative amount, amount above limit, mismatched balance math, wrong recipient. These must all fail verification.

### 10.4 Git discipline

- Branch naming: `feat/`, `fix/`, `chore/`, `security/`, `refactor/`.
- Commit messages in imperative mood: "add envelope verification" not "added".
- No secrets in commits. Ever. Install `git-secrets` or `detect-secrets` as a pre-commit hook.
- Security-touching PRs get a `security/` prefix and require a "why this is safe" paragraph in the description.

### 10.5 Naming

- Money: always `amountKobo` or `balanceKobo`. Never just `amount` or `balance` — invites unit bugs.
- Booleans: `isValid`, `hasSigned`, `canReconcile`. Not `valid`, `signed`, `reconcile`.
- Async functions: no `Async` suffix unless disambiguating from a sync version.

---

## 11. Working with AI assistants
Codex sessions should open by reading AGENTS.md end to end then reading /shared/src/index.ts to understand what already exists.

### 11.1 Before asking for code

1. Open this file, find the relevant section, paste it into the prompt or ensure the agent has read it.
2. State the goal in one sentence.
3. State the constraints — "must not change envelope schema," "must pass existing tests," "must not add new dependencies."
4. State the expected output — "one function in `/backend/src/reconcile/verify.ts`, with matching unit tests in `verify.spec.ts`."

### 11.2 Reviewing AI-generated code

Codex is a coding assistant, not a security reviewer. For every piece of security-critical code it produces, the developer must:

1. Read every line. Understand every line. If you cannot explain a line to another person, delete it and ask the assistant to simplify.
2. For each security property (signature validity, no double-spend, no negative balance, proper auth), ask "how does this line contribute to or threaten that property?"
3. Write or update the corresponding unit test and run it locally.
4. If you cannot explain why the code is safe to a hypothetical auditor, the code does not ship.

### 11.3 Prompts to avoid

- "Just make it work" — leads to silent assumptions.
- "Make it more secure" — too vague; the assistant will over-engineer or miss the point.
- "Add auth" — specify which auth, where, and against what threat model.
- Anything involving pasting a private key, an API secret, or a real user's data.

### 11.4 Prompts that work well

- "In `/backend/src/reconcile/verify.ts`, implement `verifyEnvelope` following the 8-step checklist in AGENTS.md section 7.3. Add a failing test for each step."
- "I want to add a `/admin/user/:id/flag` endpoint. It must be admin-only, rate-limited to 10/min, log the action to the audit log, and return a 404 for non-existent users. Show me the controller, DTO, and one e2e test."
- "Review this function against AGENTS.md section 7. List anything that violates the rules."

### 11.5 When Codex is likely to be wrong

Watch out carefully in these areas — even smart assistants regularly produce subtly wrong code:

- **Canonicalization.** If the client and server canonicalize differently by a single byte, signatures will never match. Test both sides against fixed test vectors.
- **Race conditions.** AI often misses that two concurrent requests can both pass a "check then update" pattern. Always use database-level serializable transactions for balance changes.
- **Timestamp handling.** Timezone bugs are common. Always store UTC, always parse explicitly.
- **Error messages.** AI likes to return helpful error messages like "invalid signature for user u_abc123." Those leak information. Return generic errors to clients, detailed errors to logs.
- **Crypto library misuse.** It is possible to use libsodium incorrectly. Verify against published examples from the library's own docs.
- **Prisma transactions.** Nested `prisma.$transaction` calls and interactive transactions behave subtly differently. AI assistants mix them up frequently.

---

## 12. Antigravity and Codex workflow

### 12.1 Recommended division of labor

- **Antigravity:** use for multi-file refactors, running the dev server, debugging with breakpoints, visualizing the codebase. Good for when you need to see the whole picture.
- **Codex (terminal):** use for generating specific files, writing tests, explaining existing code, pair-debugging. Good for focused, one-file-at-a-time work.
- **Manual editing:** use for anything in security-critical folders when you want full control and no surprises.

### 12.2 Context management

Both tools have context limits and hallucinate more when stretched. To get the best results:

- Start each session by pointing the tool at this AGENTS.md and the relevant subdirectory.
- Work one feature at a time. Close one before starting the next.
- Regularly run tests and commit. Small, verifiable steps beat large vibes-based refactors.
- When an AI tool suggests a change across many files, do it in chunks. Review each chunk.

### 12.3 The security-critical checklist (paste into prompt when working in crypto/, reconcile/, balance/)

```
This change touches a security-critical folder. Before finalizing:
1. Confirm the change does not weaken any property in AGENTS.md section 7.
2. Confirm no private keys, raw signatures, or balance values are logged.
3. Add a red-team unit test: what's the malicious input this should reject?
4. Confirm the code uses only approved crypto libraries per section 4.
5. Explain in one paragraph why this change is safe.
```

---

## 13. Definition of done for a feature

A feature is not done until all of these are true:

- [ ] Code compiles with `strict: true` and no `any` in security-critical paths.
- [ ] Unit tests pass locally and in CI.
- [ ] Integration tests pass for affected endpoints.
- [ ] For security-critical paths: red-team tests included, all pass.
- [ ] No secrets in commits, no hardcoded credentials.
- [ ] Logs include request ID and exclude sensitive data (keys, full envelope in plaintext for failed signatures, phone numbers).
- [ ] Rate limiting configured where applicable.
- [ ] The developer can explain the feature end-to-end without reading the code.
- [ ] If user-facing, at least one manual test on a physical device (not just simulator).

---

## 14. What we are NOT building (yet)

Scope discipline. These are tempting and will kill the pilot. Do not build them until after college week:

- Student-to-student transfers (would break the closed-loop legal structure)
- Student cashouts to naira (same reason)
- Biometric authentication (nice-to-have; PIN is enough for pilot)
- Push notifications (nice-to-have)
- In-app chat or messaging
- Merchant admin dashboard beyond basic cashout request
- Multi-currency support
- Transaction dispute flow (handle manually during pilot)
- Analytics dashboards beyond Supabase/Prisma Studio queries
- Dark mode, theming
- Loyalty/points/referral rewards as core features (these are campaign mechanics, not core product — keep them in a separate module that can be disabled)
- Social features, leaderboards in-app (run these off-app during the pilot via a separate web dashboard)
- also reference ./POST_PILOT.md for more features
- KYC beyond email verification
- NIN or BVN collection or verification
- Bulk personal data storage beyond email, optional phone, and pseudonymous user ID
- Device fingerprinting
---

## 15. Contact and escalation

When in doubt, STOP and ask the developer. Do not guess on:

- Anything touching the closed-loop legal structure (consult the lawyer)
- Anything that would hold customer funds beyond the float model (regulatory violation)
- Anything involving BVN, NIN, or KYC data handling (consult data protection rules)
- Anything that would require a new CBN license category
- Any change that would require altering the signed envelope schema (breaks backward compatibility)

---

---

## 16. Environment specifics

### 16.1 Primary development environment
- **OS:** Windows 11
- **Terminal:** PowerShell (not cmd, not Git Bash)
- **Node:** 20+
- **Package manager:** pnpm 10+
- **Editor:** Antigravity (primary), with Codex in terminal as companion

When providing shell commands, use **PowerShell syntax**, not Unix/bash. Examples:
- Use `New-Item -ItemType Directory -Force -Path ...` not `mkdir -p ...`
- Use `Test-Path` and `Get-Content` for file checks
- Use `Get-ChildItem -Recurse` not `find` or `ls -R`
- Use backslashes in paths when typed manually (PowerShell accepts both but backslashes match the OS)

### 16.2 Save-before-verify discipline
In any editor, file existence is not the same as file content. Before running anything that depends on a file:
1. Paste content
2. Ctrl+S immediately
3. Verify with `Get-Content <file> | Measure-Object -Line` in terminal
4. Only then run tests or commands

Creating a file without saving is a silent failure mode that costs hours to debug otherwise.

### 16.3 Git hygiene
- `.gitignore` must use `**/node_modules/` pattern (matches nested pnpm node_modules, not just root)
- Always run `git status` before `git commit` — read the output, don't skim
- Before first commit on a new machine: verify `git ls-files | Measure-Object` shows a reasonable count (under ~50 for this project until mobile app is added)
- Line endings: the `.gitattributes` file enforces LF across platforms; do not override

### 16.4 Monorepo notes (pnpm workspaces)
- Each workspace (`shared`, `backend`, `mobile`) has its own `package.json` and its own `node_modules/` folder
- This is correct and expected — pnpm uses symlinks back to a shared store
- `pnpm --filter @oneto/<package> <command>` runs a command in a specific workspace
- `pnpm -r <command>` runs recursively across all workspaces

### 16.5 Lessons learned (living log)

- Initial envelope tests: 16/16 passed (happy path + 13 red-team cases + canonicalization determinism)
- Confirmed: Ed25519 signing/verification round-trips correctly with `@noble/ed25519` + the `sha512Sync` shim
- Confirmed: canonicalization produces identical bytes regardless of object key order
- Confirmed: Korapay signs JSON.stringify(data) server-side per their docs. Verifying against raw body would break legitimate webhooks. Defensive comment in korapay.service.ts.
- Three security audits surfaced real bugs: Ghost Money invariant violation, cashout race condition, regulatory balance cap missing. All fixed pre-launch.
- Architecture pattern: state transitions and balance changes must be in the SAME transaction. Fix #6 caught a stuck-cashout case where status moved to APPROVED but the server crashed before balance reservation could fire.
- Architecture pattern: external API calls (Korapay) must NOT be inside Prisma transactions. Fire after the transaction commits.
- Tests covered logic but not infrastructure (build pipeline, DI bootstrap, DB connection). Production deployments revealed gaps that tests didn't catch (NestJS DI for OtpStoreService missing @Optional, Prisma adapter version mismatch, PowerShell BOM corruption in migrations). Future: add a single e2e test that boots the actual NestJS app against a real test database.

**Last updated:** 2026-05-01
**Document owner:** Pelumi Adeluka
**Review cadence:** every two weeks during pilot, monthly after.
