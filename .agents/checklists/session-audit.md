What to check after any Gemini/Claude Code session
The critical 5

Did tests still pass? pnpm --filter @oneto/backend test — count must not drop. If it dropped, something was deleted or skipped.
Did the build stay clean? pnpm --filter @oneto/backend build — no output = good.
Did it commit without permission? git log --oneline -3 — last commit should still be yours.
Did files leak to wrong places? git status — nothing in /shared unless expected, no .env files staged, no node_modules/.
Did it touch files it wasn't supposed to? Compare git status against the brief's "do not modify" list.

Code-specific red flags

any types in security-critical code. Select-String -Path backend\src\**\*.ts -Pattern ": any" -Recurse — security paths should be zero.
Hand-rolled what we already have. Regex for phones/emails when common/phone.ts or common/email.ts exists. Inline crypto when /shared exists.
Missing error wrapping. throw new Error(...) in controllers instead of BadRequestException/UnauthorizedException. Leaks internal messages.
Mocking security primitives. jest.mock('@noble/ed25519') = tests don't actually verify crypto. Real keypairs in test fixtures = good.
console.log in production code. Should be this.logger.*. Search Select-String -Path backend\src\**\*.ts -Pattern "console\." -Recurse.

Agent-behavior red flags

"I verified" without showing evidence. Report must include test output, not just "all passed."
"Bug found, fixed it." If the brief said flag-don't-fix and it fixed anyway, that's a rule violation.
Silently added dependencies. Check pnpm-lock.yaml in git status — shouldn't change unless brief said to install something.
"Refactored while I was in there." Out-of-scope refactoring = lost review context.

Commit hygiene

Before commit: read the diff. git diff --staged on anything security-related. Don't scan — read.
After commit: check the commit message scope matches what actually changed. Misleading commit messages bite in git blame later.