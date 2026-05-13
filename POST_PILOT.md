# POST_PILOT.md

Living document of features, infrastructure, and operational items deferred until after controlled beta/public pilot. This is the "what we'll do later" list for scale and expansion work, not pre-launch readiness.

ROADMAP.md is now the source of truth for pre-pilot and pilot-readiness work.
POST_PILOT.md is for after controlled beta/public pilot only.

Closed-loop guardrails remain non-negotiable in all phases:
- no P2P
- no student cashout
- approved merchants only

Format per item: brief description, current pilot impact, trigger for prioritization, rough effort estimate. Each item ends up on the post-pilot roadmap when its trigger fires.

Last updated: 2026-05-13

---

## Scope boundary (not post-pilot)

These are required before real-money public launch and are tracked in ROADMAP.md, not here:
- CI/build gate and production-equivalent build checks
- Daily invariant check procedure
- Basic incident playbook
- Merchant onboarding checklist
- Refund/support process
- Cashout dry run
- Written legal opinion before public real-money launch
- Manual key-recovery runbook for support ops

---

## Section 1: Product scope expansion

These break the closed-loop legal structure of the pilot. Cannot ship until regulatory path is established.

**Student-to-student (P2P) transfers**
- Original PayStash/oneto vision.
- Blocked by CBN MMO license requirement.
- Trigger: sandbox approval, MMO license, or sponsor-bank partnership.

**Student cashout to naira**
- Same blocker as P2P transfers.

**True wallet (not closed-loop credits)**
- Graduation path after regulatory approval.

**Open-loop graduation**
- Students spend anywhere, not just participating merchants.

**Multi-currency support**
- Starting with USD for diaspora.
- Trigger: post-graduation expansion.

---

## Section 2: Regulatory and corporate

**CBN Regulatory Sandbox application**
- Use pilot data as evidence for novel-tech acceptance.
- Trigger: post-pilot, after metrics are collected.

**PSSP license pursuit (~₦350M total capital)**
- Medium-term goal after seed round.

**MMO license pursuit (₦4B total)**
- Long-term, requires major funding or sponsor-bank partnership.

**Sponsor-bank / MMO partnership model**
- Alternative to direct licensing.
- Trigger: pursue actively after pilot. Possibly via Korapay (founder is CU alumni).

**Korapay sponsor-bank partnership conversation**
- Reach out to Korapay's partnerships team or Dickson directly via CU alumni network after college week.
- Bring metrics, not a pitch deck.

**NDPC registration as data controller of major importance**
- Trigger: 200+ users in 6 months.
- Designate a Data Protection Officer at the same time.

**Insurance**
- Operational risk, cyber risk, director liability.
- Trigger: any expansion beyond pilot.

**SOC 2 Type 2 certification**
- Trigger: enterprise customers, B2B partnerships.

**PCI-DSS Level 1 compliance**
- Only needed if oneto ever handles raw card data.
- Currently Korapay handles all card data — not on critical path.

**Proper legal entity structure**
- Separate operating company, escrow account, etc.
- Trigger: regulatory licensing or seed round.

---

## Section 3: KYC and identity

**Licensed NIN verification via VerifyMe/Prembly or similar**
- Required for any user tier beyond basic closed-loop.
- Trigger: PSSP/MMO pursuit OR student cashout feature OR > 200 users.

**BVN verification via licensed vendor**
- Required for high-tier wallets and Korapay VBAs.
- Trigger: same as above.

**Korapay Identity APIs (BVN, NIN, vNIN) for KYC tier upgrades**
- Built-in option once licensed verification is required.

**Korapay KYB (CAC verification) for merchant onboarding**
- Trigger: scale beyond curated pilot merchant list.

**Full KYC tiering aligned with CBN customer due diligence expectations**
- Trigger: any expansion beyond closed-loop.

---

## Section 4: Authentication and account recovery

**Lost-key recovery flow** *(from audit round 3)*
- Current: if a user loses their phone, admin must manually clear their public key from the database before they can re-register from a new device.
- Pilot/public-launch requirement: keep and follow the manual key-recovery runbook (tracked in ROADMAP.md).
- Post-pilot item: automate this with email-based confirmation + cooling-off window to reduce support load.
- Trigger: after pilot if recovery volume is non-trivial.
- Effort: ~2 days.
**Multi-device support**
- Current: one public key per user; re-registering on a second device replaces the first.
- Trigger: post-pilot user feedback or web dashboard launch.
- Effort: ~3 days. Schema change for multiple active keys per user with explicit revocation. (Option C from architecture discussion.)

**Admin-approved key rotation for high-value users**
- Out-of-band verification flow.
- Trigger: high-value user request.

**Telegram OTP as secondary channel**
- With oneto bot + user linking flow.
- Trigger: SMS becomes available, or Telegram becomes a preferred user channel.

**Phone number as 2FA / recovery channel**
- For users who do have a SIM.
- Trigger: post-pilot, when SIM ban no longer applies.

**Biometric app unlock (Face ID, fingerprint)**
- Pilot uses PIN only.
- Trigger: standard mobile UX upgrade.

**Passkeys / WebAuthn for passwordless re-login**
- Trigger: web dashboard or web admin needs login.

**Social login (Google especially, since CU uses Google Workspace)**
- Trigger: post-pilot UX improvement.

**JWT secret rotation strategy** *(from audit round 3)*
- Current: single secret in env var, no rotation.
- Pilot impact: low (15-min token lifetime limits exposure).
- Trigger: production scale or any secret-leakage incident.
- Effort: ~1 day. Implement key versioning with overlapping validity windows.

---

## Section 5: Backend infrastructure and scaling

**Redis-backed OTP store** *(from audit rounds 2 and 3)*
- Current: in-memory Map. Server restart wipes all active OTPs.
- Pilot impact: low (single instance, restart rare).
- Trigger: horizontal scaling, deploy frequency increases, OR availability SLA needs to exceed 99%.
- Effort: ~1 day. Implement OtpStore interface with Redis backend (ioredis or upstash-redis), keep in-memory as test/dev fallback.

**Redis-backed throttler**
- Current: in-memory throttler.
- Pilot impact: low (single instance).
- Trigger: horizontal scaling.
- Effort: ~half day. @nestjs/throttler supports Redis storage out of the box. Ties into same Redis migration as OTP store.

**Per-user rate limit on more endpoints** *(from audit round 3)*
- Current: per-user limits on /reconcile, /cashout/request, /cashout/approve. Other authenticated endpoints (/me, /me/ledger, /auth/keys/register) still use global IP throttle.
- Pilot impact: low.
- Trigger: any abuse incident.
- Effort: ~1 hour per endpoint.

**Health endpoint upgrade** *(from audit round 3)*
- Current: /health returns hardcoded `{"status":"ok"}` — true even if database is unreachable.
- Improvement: query database (`SELECT 1`) and only return ok if it succeeds.
- Trigger: any false-positive uptime alert.
- Effort: ~1 hour.

**Webhook payload tighter Zod schema** *(from audit round 3)*
- Current: KorapayWebhookSchema validates structure but uses `.passthrough()` for unknown fields.
- Trigger: post-pilot when there's time to make schema strictly mirror Korapay's documented payloads. Useful for catching API contract drift.

**Audit log for admin actions** *(from audit round 3)*
- Current: no separate audit trail for actions like cashout approvals or user freezes — these are inferable from ledger entries but not centralized.
- Trigger: scaling admin team or compliance audit.
- Effort: ~1 day. Dedicated AuditLog table with admin user, action, target, timestamp, before/after snapshot.

**Phantom-sync for offline merchants** *(from audit round 3)*
- Where a nearby phone with internet relays envelopes to the server on behalf of an offline merchant.
- Trigger: deployment to lower-connectivity environments.
- Effort: ~1 week.

**Bidirectional reconciliation**
- Server pushing reconciled state to senders.
- Currently senders learn their balance was debited via their next /me request, not push.
- Trigger: scale beyond pilot.
- Effort: ~1 week.

**Proper secrets management (Doppler, Infisical, AWS Secrets Manager)**
- Currently .env files + Railway env vars.
- Trigger: production scale.

**HSM (Hardware Security Module) or AWS KMS for server-side keys**
- Currently env vars.
- Trigger: production scale.

**Automated backup verification**
- Don't just have backups — test restoring them.
- Trigger: before any expansion beyond pilot.

---

## Section 6: Mobile app

**Push notifications**
- For transaction confirmations, low-balance alerts, etc.

**Device attestation on login**
- Verify the phone isn't rooted before trusting a keypair.
- Trigger: post-pilot security hardening.

**Certificate pinning in the mobile app**
- Listed in CLAUDE.md but often deferred.
- Trigger: post-pilot security hardening.

**Bank code lookup via Korapay's banks API**
- For better UX, the mobile app should present merchants with a dropdown of Nigerian banks (name + code) from Korapay's list endpoint, rather than typing a 3-digit code.
- Trigger: post-pilot UX cleanup.

**Dark mode**

**Transaction receipts as images**
- Screen-recordable, shareable.

---

## Section 7: User experience and engagement

**Real merchant admin dashboard**
- Beyond "request cashout" button. Full analytics, reconciliation, dispute tools.

**Transaction dispute flow**
- Currently handled manually during pilot.

**Analytics dashboards beyond Supabase queries**

**In-app messaging / chat**

**Loyalty/points/referral rewards as core product features**
- Not just campaign mechanics.

**Social features and in-app leaderboards**
- Gamification built into the core product.

**Auto-refund of unspent closed-loop credits**
- After a configurable window.

**PayStash Wrapped–style yearly summaries**

**Branded HTML email templates**
- Logo, brand colors, dark-mode friendly.

---

## Section 8: Korapay integrations beyond pilot

**Migrate to Virtual Bank Accounts (VBA)**
- Better UX (direct bank transfers, no card friction).
- Trigger: post-BVN-collection.
- Effort: ~1 week.

**Korapay Payouts + Beneficiary Management for automated merchant cashouts**
- Currently manual admin approval is the policy decision; Korapay supports beneficiary management for automation.
- Trigger: scale beyond pilot.

**Auto-approved cashouts with fraud rules**
- Daily limits, velocity checks, admin override.

**Virtual Cards consideration**
- Only if pursuing open-loop expansion.

---

## Section 9: Operations and risk

**Merchant protection fund**
- Reimbursements for double-spend losses.
- Trigger: scale beyond pilot.

**User blacklist and flagging workflow with admin review UI**
- Trigger: scale beyond pilot.

**24/7 fraud monitoring**
- Pilot relies on daily manual review.
- Trigger: scale beyond pilot.

**Professional penetration testing**
- Trigger: before any expansion beyond pilot, before MMO/PSSP application.
- Cost: ~$5k-15k for a reputable Nigerian or pan-African security firm.

---

## Section 10: Code health and developer workflow

**Branded `Email` type rename** *(from audit round 3)*
- Current: OTP target keys reuse `E164` branded type for emails (legacy from when SMS was the plan).
- Pilot impact: zero (works correctly).
- Trigger: code health refactor sprint.
- Effort: ~half day.

**E164 → OtpTarget rename**
- Same as above; rename the branded type to be channel-agnostic.

**Replace float math for kobo/naira conversions with integer/BigInt throughout**
- Trigger: code health pass.

**Add .gitattributes to enforce consistent line endings across the repo**
- After multiple BOM/encoding issues during deployment.

**ADD COLUMN NOT NULL migration pattern with backfill**
- For schema changes on a populated production database.
- Currently our migrations assume an empty DB.
- Trigger: first schema change in production.

**Tighten Antigravity rules file to make "do not commit" unambiguous**
- Background: agents committed without permission twice during development.
- Already partially done (added explicit hard rule).

**Merchant-auth silent enumeration check** *(from audit round 2)*
- Current: signing up as merchant with a student-already-registered email returns `email_already_registered_as_student`.
- Minor enumeration leak (confirms an email is a student).
- Note: this is pre-public-launch hardening and should be tracked in ROADMAP.md until closed.
- Effort: ~half day. Match the pattern used in regular auth (silent success).

**Chunked OTP cleanup sweep**
- Current implementation is fine for pilot scale.
- Replace with chunked sweep or expiry-queue-based cleanup at scale.

---

## Section 11: Team operations

**Google Workspace for oneto team email**
- Trigger: when team expands (add co-founders, hires).
- Cost: $6/user/month.

**Co-founder agreements with vesting**
- Critical to sign BEFORE building more, regardless of post-pilot status.
- Already on Phase 5 of ROADMAP.

---

## Notes on prioritization

When evaluating "what should we do next?" after pilot:

1. **Critical path:** items where the trigger has fired (200+ users → NDPC; new feature → KYC; etc.). Do these first.
2. **Risk reduction:** lost-key automation (post-pilot), audit log, backup verification, and hardening work that prevents expensive incidents at scale.
3. **Growth enablers:** VBAs, partnerships, multi-device, push notifications. Drive adoption.
4. **Polish:** dark mode, branded emails, bank code lookup UX. Last.

When in doubt, items in Section 5 (Backend Infrastructure) come before Section 7 (UX) — infrastructure technical debt compounds; UX debt doesn't.
