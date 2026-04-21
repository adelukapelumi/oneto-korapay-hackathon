---
trigger: always_on
---

---
description: Mandatory rules for ANY AI agent working on the oneto codebase.
---

# oneto Project Rules — Non-Negotiable

Read CLAUDE.md in full before making any changes. If CLAUDE.md and this file conflict, ask the developer — do not pick one silently.

## Verification requirements

1. After writing any code, run the tests for that package. Do not report "done" without showing test output.
2. If you write feature code, write test code in the same session. Features without tests are incomplete, not done.
3. For security-critical paths (crypto, auth, reconcile, balance, webhook handlers), minimum three red-team tests are required: one testing the happy path, one testing a specific attack, one testing an edge case. If you cannot describe the attack the test defends against, the test is not useful — write a better one.

## Git hygiene requirements

1. Every session that produces code ends with a git commit, or an explicit handoff note explaining what is uncommitted and why.
2. Run `git status` before ending any session. Report untracked files to the developer. Do not leave work uncommitted without flagging it.
3. Do not create `GEMINI.md`, `COPILOT.md`, or other tool-specific context files. There is one canonical context document: CLAUDE.md. Read it regardless of which tool you are.

## Environment requirements

1. The developer is on Windows 11 with PowerShell. All shell commands must use PowerShell syntax.
2. Use `New-Item`, `Test-Path`, `Get-Content` — not `mkdir -p`, `ls`, `cat`.
3. When recommending commands, paste exactly what the developer should run, with no Unix-style placeholders.

## Code quality requirements

1. TypeScript strict mode is required in every workspace. No `any` types in security-critical files.
2. Branded types (`Kobo`, `UserId`, `TransactionId`) must be used everywhere they apply. Never pass raw numbers or strings to functions that expect branded types.
3. All monetary values are integer kobo. Floats for money are a serious bug.
4. All timestamps are ISO 8601 UTC. Local time zones are a bug.

## Reporting requirements

When a task is complete, provide:
- List of files created or modified with a one-sentence summary per file
- Output of the last successful test run
- Output of `git status` showing what remains uncommitted
- List of any assumptions made or decisions deferred

Do not claim work is complete if any of the above is missing.

## Forbidden behaviors

1. Do not rename, duplicate, or fork CLAUDE.md.
2. Do not commit secrets, `.env` files, `node_modules/`, or compiled output.
3. Do not skip tests because "the code is obviously correct." Security-critical code is never obviously correct.
4. Do not invent library APIs. If you are not certain a method exists, check the library's documentation or admit uncertainty.
5. Do not say "I have secured the system" without a test proving the security property holds.