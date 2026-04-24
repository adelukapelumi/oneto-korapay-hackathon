---
trigger: always_on
---

---
trigger: always_on
---
---
description: Mandatory rules for ANY AI agent working on the oneto codebase.
---

# oneto Project Rules — Non-Negotiable

Read CLAUDE.md in full before making any changes. If CLAUDE.md and this file conflict, ask the developer — do not pick one silently. If a task brief from the developer conflicts with this file, the brief wins for that session.

## Session control (HARDEST RULES — violations invalidate the task)

1. NEVER run `git add`, `git commit`, `git push`, or any git write operation unless the developer explicitly instructs it IN THE CURRENT SESSION. "Commit this" or "push it" from the developer is required. Past sessions do not grant commit authority for current work.
2. If in doubt about whether to commit, DO NOT COMMIT. Report completion with `git status` output and wait for the developer to approve.
3. Committing without explicit permission is a task failure, regardless of code quality.

## Verification requirements

1. After writing any code, run the tests for that package. Do not report "done" without showing test output.
2. If you write feature code, write test code in the same session. Features without tests are incomplete, not done.
3. For security-critical paths (crypto, auth, reconcile, balance, webhook handlers), minimum three red-team tests are required: one testing the happy path, one testing a specific attack, one testing an edge case. If you cannot describe the attack the test defends against, the test is not useful — write a better one.

## Git hygiene requirements

1. At the end of every code-producing session, run `git status` and report what is uncommitted. The developer commits.
2. Do not create `GEMINI.md`, `COPILOT.md`, or other tool-specific context files. There is one canonical context document: CLAUDE.md. Read it regardless of which tool you are.
3. Do not modify `.env` files. The developer manages real secrets.

## Environment requirements

1. The developer is on Windows 11 with PowerShell. All shell commands must use PowerShell syntax.
2. Use `New-Item`, `Test-Path`, `Get-Content` — not `mkdir -p`, `ls`, `cat`.
3. When recommending commands, paste exactly what the developer should run, with no Unix-style placeholders.

## Code quality requirements

1. TypeScript strict mode is required in every workspace. No `any` types in security-critical files (auth, crypto, reconcile, topup, balance).
2. Branded types (`Kobo`, `UserId`, `TransactionId`, `E164`) must be used everywhere they apply. Never pass raw numbers or strings to functions that expect branded types.
3. All monetary values are integer kobo. Floats for money are a serious bug.
4. All timestamps are ISO 8601 UTC. Local time zones are a bug.
5. Before using any library API, verify the method exists and its signature. Do not invent or assume APIs. If uncertain, check the package's docs or node_modules/types.

## Reporting requirements

When a task is complete, provide:
- List of files created or modified with a one-sentence summary per file
- Output of the last successful test run
- Output of `git status` showing what is uncommitted
- List of any assumptions made or decisions deferred
- List of any bugs discovered in existing code (do not fix without flagging)

Do not claim work is complete if any of the above is missing.

## Forbidden behaviors

1. Do not rename, duplicate, or fork CLAUDE.md.
2. Do not commit secrets, `.env` files, `node_modules/`, or compiled output.
3. Do not skip tests because "the code is obviously correct." Security-critical code is never obviously correct.
4. Do not invent library APIs. If you are not certain a method exists, check the library's documentation or admit uncertainty.
5. Do not say "I have secured the system" without a test proving the security property holds.
6. Do not commit as a "convenience" for the developer. The developer commits.