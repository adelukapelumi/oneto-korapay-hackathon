# oneto Pilot Roadmap

Single-page view of what's left to ship a pilot-ready MVP for college week at Covenant University.

Status legend: ⬜ not started, 🟡 in progress, 🟢 done, 🔵 blocked/waiting

Last updated: 2026-04-24

---

## Current state snapshot

- Backend auth module complete (email OTP via Resend, 49 tests)
- Korapay top-up flow complete (webhook HMAC verified, Serializable transaction, 15 tests)
- Shared crypto foundation complete (Ed25519, envelope schema, 16 tests)
- Total: 82 tests passing, clean builds, committed and pushed
- What's missing: reconcile endpoint, mobile app, merchant flow, deployment

Roughly 40% of pilot MVP scope complete.

---

## Phase 1 — Backend core (the rest of the API)

Gets the server ready to actually handle transactions.

### 1.1 Reconcile endpoint ⬜
- Public key registration endpoint (`POST /auth/keys/register`, authenticated)
- Reconcile endpoint (`POST /reconcile`, merchant-auth, envelope validation)
- Tighten clock skew tolerance to 120 seconds
- Anti-replay via per-user sequence number uniqueness (not strict monotonicity)
- Serializable Prisma transaction for balance updates
- Red-team tests: tampered envelope, replay, wrong recipient, expired, overdraft
- Target: ~20-25 tests, all passing

### 1.2 Merchant onboarding backend ⬜
- Merchant signup endpoint (email required, phone recommended, business name, bank account)
- Merchant-specific role and status flow
- DTO validation, unique business name within region
- Target: ~8-10 tests

### 1.3 Merchant cashout flow ⬜
- Cashout request endpoint (merchant-auth)
- Admin review queue endpoint (admin-auth)
- Korapay Payout API integration for actual bank transfer
- Ledger entries for cashout (merchant DEBIT, operating account CREDIT)
- Target: ~12 tests

### 1.4 Me + ledger endpoints ⬜
- `GET /me` — profile + verified balance
- `GET /me/ledger` — paginated transaction history
- Target: ~6 tests

**Phase 1 total effort: estimated 3-4 focused sessions (~8-12 hours)**

---

## Phase 2 — Mobile app (the user-facing side)

Where students and merchants actually live.

### 2.1 Scaffold + auth flow ⬜
- Expo SDK 52 project setup in `/mobile`
- Email + OTP login screens
- JWT storage via expo-secure-store
- API client with base config and interceptors

### 2.2 Keypair management ⬜
- Ed25519 keypair generation on first login
- Private key to expo-secure-store
- Public key registration with backend
- One-time "complete pending transactions before uninstalling" warning UX

### 2.3 Student payment flow ⬜
- Scan merchant's request QR
- Show payment confirmation ("Pay ₦500 to Food Stand A?")
- Generate signed envelope locally
- Display envelope as QR for merchant to scan
- Local SQLite ledger for pending envelopes

### 2.4 Merchant payment flow ⬜
- Generate request QR (amount + merchant ID + nonce)
- Scan student's signed envelope QR
- Verify signature locally
- Store in local ledger as pending
- Sync button (or auto-sync) to call `/reconcile`

### 2.5 Top-up flow (students) ⬜
- "Add Funds" screen
- Call `/topup/korapay/initiate`
- Open Korapay checkout URL in WebView
- Handle success/failure return

### 2.6 Cashout flow (merchants) ⬜
- Balance display
- Request cashout button
- Bank account info collection
- Status tracking

### 2.7 History screens ⬜
- Transaction history for both roles
- Pending vs reconciled indicator
- Pull-to-refresh

**Phase 2 total effort: estimated 6-8 focused sessions (~20-30 hours)**

---

## Phase 3 — Admin dashboard

What the oneto team uses to operate the pilot.

### 3.1 Admin auth ⬜
- Separate admin login (could be separate URL or role-gated)
- Admin user creation via CLI script (not exposed as endpoint)

### 3.2 Cashout approvals ⬜
- List pending cashout requests
- Approve/reject flow (manual review)
- Audit log of every action

### 3.3 User management ⬜
- Search users by email
- View balance, transaction history
- Flag or freeze accounts
- Unfreeze accounts

### 3.4 Daily reconciliation report ⬜
- `GET /admin/reconciliation-report`
- Shows sum of all balances + operating account
- Alerts if the invariant is broken

**Phase 3 minimum for pilot: admin auth + cashout approvals only. Everything else can be queried via Prisma Studio.**

**Phase 3 total effort for MVP: estimated 1-2 sessions (~4-6 hours)**

---

## Phase 4 — Deployment and operations

Getting it running on the public internet.

### 4.1 Database ⬜
- Provision Postgres (Neon or Railway)
- Run Prisma migrations against real DB
- Seed operating account (`u_operating`)
- Verify connection from backend

### 4.2 Backend deployment ⬜
- Railway or Render project setup
- Environment variables from Doppler/Infisical or direct secrets
- Public URL for Korapay webhook
- Healthcheck endpoint (`GET /health`)

### 4.3 Webhook registration ⬜
- Register deployed URL with Korapay dashboard
- Register with Resend for delivery webhook
- Test end-to-end payment flow with real money (sandbox mode initially)

### 4.4 Mobile app distribution ⬜
- Expo EAS build configuration
- iOS TestFlight for beta testers
- Android APK or Internal Testing track
- Update URL for existing users

### 4.5 Monitoring ⬜
- Sentry integration (backend + mobile)
- UptimeRobot or Better Stack for healthcheck ping
- Axiom or Logtail for structured log aggregation
- Daily invariant check cron job

**Phase 4 total effort: estimated 2-3 sessions (~6-10 hours)**

---

## Phase 5 — Pilot launch prep

Last-mile before real users touch it.

### 5.1 Legal and operational ⬜
- Complete ONETO INFRASTRUCTURE LIMITED CAC registration
- Get formal CU authorization to operate (written, not verbal)
- Sign co-founder agreements with vesting
- Draft full Privacy Notice and Terms (upgrade from placeholder)
- Set up `privacy@getoneto.com` as working inbox

### 5.2 Merchant onboarding ⬜
- Identify 10-15 participating merchants for college week
- Collect business details and bank accounts
- Pre-create their accounts in the system
- Print their payment request QR templates

### 5.3 User testing ⬜
- Friends/family testing round (3-5 users)
- Small paid test transactions with 2-3 merchants
- Verify reconciliation happens correctly
- Fix whatever breaks

### 5.4 Pilot launch materials ⬜
- Student-facing flyer or poster ("Pay with oneto at college week")
- Merchant table/stall signs
- Onboarding table setup for college week (tablets, Wi-Fi hotspot for signup)
- Support channel (WhatsApp? Telegram?) during event

### 5.5 Incident playbook ⬜
- What happens if backend goes down mid-event
- What happens if a merchant claims they weren't credited
- What happens if a student claims their balance is wrong
- Who's on-call during college week
- Emergency shutoff procedure

**Phase 5 total effort: depends heavily on merchant recruitment, estimated 2-3 weeks calendar time**

---

## Critical path to pilot launch

The minimum sequence if you only work on one thing at a time:

1. Reconcile endpoint (Phase 1.1)
2. Mobile app: auth + keypair (Phase 2.1-2.2)
3. Mobile app: student payment flow (Phase 2.3)
4. Mobile app: merchant payment flow (Phase 2.4)
5. Mobile app: top-up flow (Phase 2.5)
6. Cashout flow (Phase 1.3 + Phase 2.6)
7. Deployment (Phase 4)
8. Admin cashout approvals (Phase 3.2)
9. Merchant onboarding + user testing (Phase 5.2-5.3)
10. Launch

Everything else is nice-to-have or can be done post-launch during the pilot itself.

---

## Out of scope for pilot

See `POST_PILOT.md` for the full list. High-level:

- Student-to-student transfers (breaks closed-loop legal structure)
- Student cashouts to naira (same reason)
- NIN/BVN verification (requires licensed KYC vendor)
- Virtual Bank Accounts (Korapay VBA requires BVN)
- Multi-device support for users
- Branded HTML emails
- Push notifications
- Transaction dispute flow
- Merchant protection fund
- NDPC registration (triggered at 200+ users in 6 months)

---

## Risk register

Things that could derail the pilot. Revisit weekly.

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CU authorization falls through | Medium | High | Get written authorization early, have a Plan B location |
| Korapay account not verified in time | Medium | High | Submit business docs early, have dashboard test keys working first |
| Mobile app rejected from app stores | Low | Medium | Use Expo for Android APK distribution as fallback |
| Co-founder equity dispute | Medium | Medium | Sign formal founder agreement BEFORE building more |
| Key merchant pulls out mid-event | High | Low | Have 15+ merchants, pilot can survive losing 2-3 |
| Backend crashes during peak | Medium | High | Healthcheck + auto-restart, capacity tested beforehand |
| Student balance mismatch incident | Medium | Critical | Daily invariant check, public support channel, refund policy documented |

---

## Decisions log

Major architectural or strategic decisions and when they were made. Add new rows as decisions happen.

| Date | Decision | Why |
|------|----------|-----|
| 2026-04 | Closed-loop prepaid model for pilot | CBN MMO capital requirement (₦4B) unachievable, avoids e-money regulation |
| 2026-04 | Email OTP instead of SMS | CU bans SIMs on campus with 3-week suspension |
| 2026-04 | Korapay Checkout API for pilot, VBA post-pilot | Checkout doesn't require BVN at signup; VBA does |
| 2026-04 | Merchant-only reconcile submission | Aligns incentives (only receivers benefit from reconciliation) |
| 2026-04 | Per-user sequence uniqueness, not strict monotonicity | Supports out-of-order merchant reconciliation |
| 2026-04 | Option A public key rotation (strict replacement) | Simpler code, small financial exposure, covered by pilot reserve |