# Oneto

Oneto is an offline-capable campus payment product designed to make payments work even when there is no immediate internet connection at the point of transaction. For the Kora 2.0 Hackathon submission, the project demonstrates how students can pay approved merchants offline with signed QR transfers and reconcile those payments later when connectivity returns.

This repository is the public codebase for the Kora 2.0 Hackathon submission by Paystash Labs.

## Hackathon Submission Snapshot

- Team name: `Paystash Labs`
- Repository: `https://github.com/adelukapelumi/oneto-korapay-hackathon`
- Project type: `Existing Project (refactored and significantly improved for the hackathon)`
- Official hackathon build phase began: `May 15, 2026`
- Primary payments integration: `Korapay`
- Backend API: `https://api.getoneto.com`
- Primary mobile deliverable: `Production Android APK`

## Problem

Many payments fail at the point of transaction because both parties need reliable internet access at the exact moment they want to pay. Oneto reduces that dependency by allowing users to create signed offline payment intents on-device, exchange them through QR codes, and complete reconciliation later online.

## What Oneto Does

- Supports offline-first student-to-merchant payments with signed QR envelopes
- Uses a backend ledger to reconcile payments safely when merchants come online
- Integrates Korapay for online top-ups and merchant cashout operations
- Provides an admin surface for merchant operations, reconciliation review, and cashout handling

## Core Guardrails

- No student-to-student transfers
- No student cashout to naira
- Approved merchants only

## Team

- Adeluka Oluwambepelumi Emmanuel - Lead Developer and Fullstack Engineer
- Oghenetejiri Ekpokpobe Great - Frontend Developer and AI/ML Engineer

## Repository Structure

- `backend/` - NestJS API for auth, reconciliation, top-ups, cashout, and admin operations
- `mobile/` - React Native / Expo mobile app for offline payments and QR-based flow
- `shared/` - shared types, limits, and signing / verification helpers
- `docs/` - submission support docs and project notes

## Stack

- Mobile: React Native, Expo, TypeScript, SQLite
- Backend: NestJS, TypeScript, Prisma, PostgreSQL
- Payments: Korapay
- Auth and notifications: email OTP flow

## Demo Format

- Student experience demonstrated on a physical Android device using the production APK
- Merchant experience demonstrated on an iOS device using Expo Go
- Demo walkthrough covers onboarding, merchant onboarding, and QR generation for the payment flow
- Backend API used by the mobile experience: `https://api.getoneto.com`

## AI Disclosure

AI assistance was used only to help draft and refine parts of this `README.md` so the public repository better communicates the project structure, submission context, and hackathon deliverables. Product logic, implementation decisions, and the application code itself remain team-owned.

## Submission Support

See [docs/hackathon-submission.md](docs/hackathon-submission.md) for the final submission summary and [docs/google-form-draft.md](docs/google-form-draft.md) for the exact form-ready answers.
