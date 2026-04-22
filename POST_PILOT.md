Post-pilot features list (as of now)
Here's everything we've discussed that's been deferred or scoped-out. Copy this into a POST_PILOT.md at the root of your repo — treat it as a living doc.
Product scope

Student-to-student (P2P) transfers. Core original PayStash/oneto vision. Blocked by CBN MMO license requirement; requires either sandbox approval, an MMO, or a sponsor-bank partnership.
Student cashout to naira. Same blocker as P2P transfers.
True wallet (not closed-loop credits). Graduation path after regulatory approval.

Regulatory and corporate

CBN Regulatory Sandbox application. Using pilot data as evidence for novel-tech acceptance.
PSSP license pursuit (~₦350M total capital). Medium-term goal after seed round.
MMO license pursuit (₦4B total). Long-term, requires major funding or sponsor-bank partnership.
Sponsor-bank / MMO partnership model. Alternative to direct licensing — partner with a licensed entity.
Open-loop graduation. Students spend anywhere, not just participating merchants.

Authentication and onboarding

Telegram OTP as secondary channel (with oneto bot + user linking flow).
Branded HTML email templates (logo, brand colors, dark-mode friendly).
Phone number as 2FA / recovery channel for users who do have a SIM.
BVN or NIN verification for higher KYC tiers (required for any post-closed-loop expansion).
Biometric app unlock (Face ID, fingerprint). Pilot uses PIN only.
Passkeys / WebAuthn for passwordless re-login.
Social login (Google especially, since CU uses Google Workspace).

Infrastructure and scaling

Redis-backed OTP store. Current in-memory Map only works for single-instance servers; Redis needed for horizontal scaling.
Proper secrets management (Doppler, Infisical, AWS Secrets Manager). Currently .env files.
HSM (Hardware Security Module) or AWS KMS for server-side keys. Currently server keys live in env.
Full observability stack: Sentry errors + Axiom logs + UptimeRobot heartbeats.
Automated backup verification. Don't just have backups — test restoring them.
24/7 fraud monitoring. Pilot relies on daily manual review.
Device attestation on login. Verify the phone isn't rooted before trusting a keypair.
Certificate pinning in the mobile app. Already listed in CLAUDE.md but often gets deferred.

Features and UX

Push notifications. For transaction confirmations, low-balance alerts, etc.
Real merchant admin dashboard (beyond "request cashout" button). Full analytics, reconciliation, dispute tools.
Transaction dispute flow. Currently handled manually during pilot.
Analytics dashboards beyond Supabase queries.
Dark mode.
In-app messaging / chat.
Multi-currency support (starting with USD for diaspora).
Loyalty/points/referral rewards as core product features (not just campaign mechanics).
Social features and in-app leaderboards. Gamification built into the core product.
Auto-refund of unspent closed-loop credits after a configurable window.
Transaction receipts as images (screen-recordable, shareable).
PayStash Wrapped–style yearly summaries.

Business operations

Merchant protection fund (reimbursements for double-spend losses).
User blacklist and flagging workflow with admin review UI.
Audit log UI for compliance reviews.
Proper legal entity structure (separate operating company, escrow account, etc.).
Insurance covering operational risk, cyber risk, director liability.
SOC 2 Type 2 certification.
Third-party penetration testing before any public launch beyond pilot.
PCI-DSS Level 1 compliance. Only needed if you ever handle raw card data (currently Korapay handles it).

Developer workflow

E164 branded type rename to something generic (OtpTarget) now that it represents emails too. TODO noted in current code.

Data migration patterns

ADD COLUMN NOT NULL migration pattern with backfill for schema changes on a populated production database. Currently our migrations assume an empty DB.

POST-PILOT: This is worth doing once you have co-founders actively working; add to your post-pilot doc as "upgrade to Google Workspace when team expands."

POST-PILOT note to add: End-to-end integration tests using NestJS test module with real Prisma against a test database. Currently unit tests only.

POST-PILOT: Full KYC tier using verified NIN via a licensed provider like VerifyMe or Prembly — required for any expansion beyond closed-loop, and absolutely necessary if you pursue a PSSP or MMO license. Add to your post-pilot doc.