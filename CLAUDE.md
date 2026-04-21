# CLAUDE.md — oneto Project Context

This file is the source of truth for any AI coding assistant (Claude Code, Antigravity, Cursor, Copilot) working on oneto. Read it in full before making changes. Re-read the relevant section before any non-trivial edit. If anything in this file conflicts with a user instruction, stop and ask — do not silently override.

---

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
3. **Reconciliation:** When either phone reconnects, it pushes pending envelopes to `/reconcile`. Server verifies signature, checks sequence monotonicity, checks claimed balance consistency with server state, writes double-entry ledger rows, updates both users' `verifiedBalanceKobo`.
4. **Merchant cashout:** Merchant requests cashout via app. Admin reviews (manual during pilot). Korapay Transfer API sends naira to the merchant's bank account. Operating account debited in the ledger.

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
- **Auth:** Phone + OTP via Termii (cheaper Nigerian SMS) or Twilio Verify. No passwords for end users.
- **Payments:** Korapay for top-ups and cashouts. Verify all webhooks via HMAC signature.
- **Monitoring:** Sentry for errors, Axiom or Logtail for logs, UptimeRobot for heartbeat checks.
- **Secrets:** Doppler or Infisical for environment variable management. Never commit `.env` files. Never paste secrets into Claude Code or Antigravity prompts.

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
├── CLAUDE.md                        this file
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
- `senderBalanceAfterKobo === senderBalanceBeforeKobo - amountKobo`. Verify at sign time and verify time.
- `amountKobo > 0`.
- `amountKobo <= MAX_OFFLINE_TRANSACTION_KOBO` (currently `200_000` = ₦2,000). Constant lives in `/shared/types/limits.ts`.

---

## 7. Cryptographic rules — read every time you touch this code

### 7.1 Hard rules

1. **Never roll your own crypto.** Always use `tweetnacl` (mobile) or `@noble/ed25519` (backend).
2. **Never store, log, or transmit a private key.** Private keys live in `expo-secure-store` on device and nowhere else. They must never appear in logs, crash reports, or error messages.
3. **Never accept an unsigned message as authoritative.** If it is not signed and verified, it is client state, not truth.
4. **Always verify signatures against the server-registered public key** for that user. The public key embedded in the envelope must match the registered one; a mismatch is a rejection.
5. **Canonicalize before signing.** Sort JSON keys alphabetically, no whitespace, UTF-8 encoding. Use the same canonicalization function on both client and server. Live in `/shared/canonicalize.ts`.
6. **Timestamps must be verified.** Reject envelopes with `expiresAt` in the past or `timestamp` more than 5 minutes in the future (clock skew tolerance).
7. **Constant-time comparison for signatures.** Use `nacl.sign.detached.verify` or `crypto.timingSafeEqual` — never `===`.

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
  // 3. Check timestamp freshness and expiry.
  // 4. Check amountKobo > 0 and <= MAX_OFFLINE_TRANSACTION_KOBO.
  // 5. Check balanceAfter === balanceBefore - amount.
  // 6. Canonicalize envelope without signature field.
  // 7. Verify Ed25519 signature using constant-time comparison.
  // 8. Return { ok: true } or { ok: false, reason: "..." }.
  // Run all 8 checks. Log which one failed for debugging, but return
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
Claude code sessions should open by reading CLAUDE.md end to end then reading /shared/src/index.ts to understand what already exists.

### 11.1 Before asking for code

1. Open this file, find the relevant section, paste it into the prompt or ensure the agent has read it.
2. State the goal in one sentence.
3. State the constraints — "must not change envelope schema," "must pass existing tests," "must not add new dependencies."
4. State the expected output — "one function in `/backend/src/reconcile/verify.ts`, with matching unit tests in `verify.spec.ts`."

### 11.2 Reviewing AI-generated code

Claude Code is a coding assistant, not a security reviewer. For every piece of security-critical code it produces, the developer must:

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

- "In `/backend/src/reconcile/verify.ts`, implement `verifyEnvelope` following the 8-step checklist in CLAUDE.md section 7.3. Add a failing test for each step."
- "I want to add a `/admin/user/:id/flag` endpoint. It must be admin-only, rate-limited to 10/min, log the action to the audit log, and return a 404 for non-existent users. Show me the controller, DTO, and one e2e test."
- "Review this function against CLAUDE.md section 7. List anything that violates the rules."

### 11.5 When Claude Code is likely to be wrong

Watch out carefully in these areas — even smart assistants regularly produce subtly wrong code:

- **Canonicalization.** If the client and server canonicalize differently by a single byte, signatures will never match. Test both sides against fixed test vectors.
- **Race conditions.** AI often misses that two concurrent requests can both pass a "check then update" pattern. Always use database-level serializable transactions for balance changes.
- **Timestamp handling.** Timezone bugs are common. Always store UTC, always parse explicitly.
- **Error messages.** AI likes to return helpful error messages like "invalid signature for user u_abc123." Those leak information. Return generic errors to clients, detailed errors to logs.
- **Crypto library misuse.** It is possible to use libsodium incorrectly. Verify against published examples from the library's own docs.
- **Prisma transactions.** Nested `prisma.$transaction` calls and interactive transactions behave subtly differently. AI assistants mix them up frequently.

---

## 12. Antigravity and Claude Code workflow

### 12.1 Recommended division of labor

- **Antigravity:** use for multi-file refactors, running the dev server, debugging with breakpoints, visualizing the codebase. Good for when you need to see the whole picture.
- **Claude Code (terminal):** use for generating specific files, writing tests, explaining existing code, pair-debugging. Good for focused, one-file-at-a-time work.
- **Manual editing:** use for anything in security-critical folders when you want full control and no surprises.

### 12.2 Context management

Both tools have context limits and hallucinate more when stretched. To get the best results:

- Start each session by pointing the tool at this CLAUDE.md and the relevant subdirectory.
- Work one feature at a time. Close one before starting the next.
- Regularly run tests and commit. Small, verifiable steps beat large vibes-based refactors.
- When an AI tool suggests a change across many files, do it in chunks. Review each chunk.

### 12.3 The security-critical checklist (paste into prompt when working in crypto/, reconcile/, balance/)

```
This change touches a security-critical folder. Before finalizing:
1. Confirm the change does not weaken any property in CLAUDE.md section 7.
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
- **Editor:** Antigravity (primary), with Claude Code in terminal as companion

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

**Last updated:** [DATE]
**Document owner:** [YOUR NAME]
**Review cadence:** every two weeks during pilot, monthly after.
