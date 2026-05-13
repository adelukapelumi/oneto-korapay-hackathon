# Oneto

Oneto is an offline-capable closed-loop campus prepaid payment system for Covenant University.
It is not a wallet, not an MMO, and not an open-loop money transfer product.

## Non-Negotiable Pilot Guardrails

- No student-to-student transfers (no P2P)
- No student cashout to naira
- Approved merchants only

## Current Status

- Backend is deployed on Railway: `https://oneto-production.up.railway.app`
- Student-led offline payment flow is implemented:
  - cached merchant list -> amount -> confirm PIN -> signed QR -> merchant scans
- Merchant list endpoint: `GET /merchants/list`
- Mobile app uses SQLite merchant cache for offline merchant selection
- Current readiness posture:
  - near controlled founder-supervised beta after real-device testing
  - not ready for public College Week scale yet

## Repository Structure

- `backend/` - NestJS API (auth, reconcile, top-up, cashout, merchant list)
- `mobile/` - React Native/Expo app (offline payment UX, signing, scan, local SQLite)
- `shared/` - shared types, schemas, limits, and signing/verification helpers
- Root/docs guidance:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `ROADMAP.md`
  - `POST_PILOT.md`

## Required Commands

Backend gate (backend-affecting changes):

```powershell
pnpm --filter @oneto/shared build
pnpm --filter @oneto/backend build
pnpm --filter @oneto/backend test
```

Full-stack/mobile/payment-flow gate:

```powershell
pnpm --filter @oneto/shared build
pnpm --filter @oneto/backend build
pnpm --filter @oneto/backend test
pnpm --filter @oneto/mobile test
```

If Railway/deploy command differs, run the production-equivalent command before declaring release readiness.

## Pilot Readiness Warning

Before public real-money launch, require all of the following:

- real-device two-phone test loop
- 100+ payment attempts logged
- reconciliation review
- daily invariant procedure
- merchant ops checklist
- incident playbook
- written legal opinion
