# oneto Roadmap: Controlled Beta -> Public Pilot

Last updated: 2026-05-13

Oneto is a closed-loop campus prepaid payment system, not a wallet/MMO.

Non-negotiable guardrails:
- No student-to-student (P2P) transfers.
- No student cashout to naira.
- Approved merchants only.

---

## 1. Current status snapshot

Backend status:
- Deployed on Railway (`https://oneto-production.up.railway.app`).
- Backend gate currently passes:
  - `pnpm --filter @oneto/shared build`
  - `pnpm --filter @oneto/backend build`
  - `pnpm --filter @oneto/backend test`
- Backend tests: 12 suites / 172 tests passing.

Mobile status:
- Mobile tests: 19 suites / 132 tests passing.
- Student-led payment flow implemented:
  - cached merchant list -> amount -> existing confirm PIN -> signed QR -> merchant scans.
- Merchant list endpoint exists: `GET /merchants/list`.
- Merchant list is cached locally in SQLite for offline use.
- Existing confirm/sign/display flow is preserved.
- Merchant scan no longer depends on merchant-generated `requestJson`.

Current honest readiness:
- Near controlled founder-supervised beta after real-device testing.
- Not ready for public College Week scale yet.

---

## 2. Phase 0 — Build/deploy discipline and CI gate

Goal:
- Make release claims trustworthy by enforcing build/test/deploy gates, not test-only claims.

Concrete checklist:
- Enforce backend-affecting gate on every backend change:
  - `pnpm --filter @oneto/shared build`
  - `pnpm --filter @oneto/backend build`
  - `pnpm --filter @oneto/backend test`
- Enforce full-stack/mobile/payment-flow gate when mobile/payment paths are touched:
  - `pnpm --filter @oneto/shared build`
  - `pnpm --filter @oneto/backend build`
  - `pnpm --filter @oneto/backend test`
  - `pnpm --filter @oneto/mobile test`
- Ensure production-equivalent deploy command is run before declaring release-ready when Railway command differs from local.
- Require deployment notes to include:
  - commands run
  - output snapshot
  - git status snapshot
  - unresolved risks

Exit criteria:
- No release declared ready on tests alone.
- Build + test gates are consistently executed and reported.
- Production-equivalent deploy command is verified before release-ready call.

---

## 3. Phase 1 — Real-device two-phone payment loop proof

Goal:
- Prove the end-to-end offline payment loop works on physical devices, not only simulator/tests.

Concrete checklist:
- Run repeated two-phone scenarios (student + merchant) using the current flow:
  - student selects cached merchant
  - student enters amount
  - student confirms PIN
  - signed QR displayed
  - merchant scans signed envelope
- Explicitly run offline scenario:
  - offline student + offline merchant
  - payment capture succeeds locally
  - reconciliation succeeds after reconnect.
- Log each run with:
  - timestamp
  - merchant id
  - amount kobo
  - transaction id
  - result (success/rejected)
  - rejection reason if any.
- Verify stuck/rejected transaction handling path in app UX and operator playbook.
- Verify replay protections are intact in observed behavior:
  - `requestNonce`
  - `senderSequenceNumber`.

Exit criteria:
- 100+ real-device payment attempts logged.
- Offline student + offline merchant scenario passes.
- Reconciliation after reconnect verified repeatedly.
- Rejected/stuck transaction handling is documented and tested.

---

## 4. Phase 2 — Controlled founder-supervised beta

Goal:
- Operate a small closed beta with direct founder oversight and daily reconciliation hygiene.

Concrete checklist:
- Limit participant group (founder-supervised cohort only).
- Keep guardrails enforced:
  - no P2P
  - no student cashout
  - approved merchants only.
- Run daily reconciliation review:
  - pending vs reconciled counts
  - failed/rejected transaction review
  - manual correction playbook if needed.
- Run daily invariant check procedure:
  - `SUM(all user balances) + operating_account_balance === 0`.
- Confirm support response path for user-reported balance/payment issues.

Exit criteria:
- Multi-day controlled beta runs with no unresolved critical incidents.
- Daily invariant procedure is executed and documented.
- Reconciliation review routine is stable and repeatable.

---

## 5. Phase 3 — Pilot operations minimum

Goal:
- Put minimum operational controls in place before opening to a larger audience.

Concrete checklist:
- Merchant onboarding checklist finalized and used for every merchant.
- Refund/support process documented and tested with a dry-run case.
- Cashout dry run executed end-to-end (request -> approval -> payout path verification).
- Incident playbook completed and shared with operators:
  - outage response
  - delayed reconciliation
  - disputed/rejected transaction handling
  - emergency pause path.
- Define on-call owner and escalation path for pilot days.

Exit criteria:
- Merchant onboarding checklist is in active use.
- Refund/support process is tested.
- Cashout dry run passes.
- Incident playbook is complete and operationally usable.

---

## 6. Phase 4 — Legal and merchant readiness

Goal:
- Ensure legal and merchant readiness is explicit before public real-money launch.

Concrete checklist:
- Obtain written legal opinion before public real-money pilot launch.
- Confirm merchant participation list and readiness status.
- Validate merchant communication pack:
  - what to do offline
  - what to do when reconciliation fails
  - support contact/escalation path.
- Validate user-facing trust and support messaging for payment issues/refunds.

Exit criteria:
- Written legal opinion received.
- Merchant readiness confirmed with named participants.
- Operations and support messaging validated.

---

## 7. Phase 5 — Public College Week readiness gate

Goal:
- Make a clear go/no-go decision for public College Week scale based on objective gates.

Concrete checklist:
- Confirm all prior phase exits are complete.
- Re-verify build/deploy discipline gate on latest release candidate.
- Verify pre-public-pilot hard requirements are complete:
  - 100+ real-device payment attempts logged
  - offline student + offline merchant test
  - reconciliation after reconnect
  - daily invariant check procedure
  - stuck/rejected transaction handling
  - merchant onboarding checklist
  - refund/support process
  - cashout dry run
  - incident playbook
  - written legal opinion before real-money public launch.
- Document residual risks and explicit owner per risk.

Exit criteria:
- Objective go/no-go checklist is fully satisfied.
- Residual risks are accepted explicitly by founder/legal decision-makers.
- Public launch decision is recorded in writing.

---

## 8. Post-pilot

All expansion, scale, and graduation items are tracked in:
- [`POST_PILOT.md`](./POST_PILOT.md)

Examples already deferred there:
- KYC expansion (NIN/BVN tiers)
- VBA and broader payment rails
- Redis OTP/throttler hardening
- lost-key recovery automation
- multi-device support
- full admin and analytics expansion
- open-loop/product-scope expansion
