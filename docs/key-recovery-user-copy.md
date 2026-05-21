# Oneto Key Recovery User Copy

Status: Approved copy source for mobile UX  
Audience: students, merchants, support operators  
Goal: explain device recovery without exposing users to cryptography

---

## 1. Copy principles

Do not say:

- private key
- public key
- Ed25519
- signature
- rotation
- verification-only key
- cryptographic identity

Say:

- linked phone
- approve this phone
- move Oneto
- secure your account
- already scanned payments
- payments may need review

Tone:

- calm
- direct
- not scary
- no blame
- no long paragraphs

## 2. Account already linked to another phone

Title:

```text
This account is already linked to another phone
```

Body:

```text
To protect your Oneto points, we need to confirm before setting up this phone.
```

Buttons:

```text
I still have my old phone
I lost my old phone
My phone was stolen
```

Small footer:

```text
This helps stop someone from taking over your account with only your email.
```

## 3. User still has old phone

Title:

```text
Move Oneto to this phone
```

Body:

```text
Open Oneto on your old phone and approve this new phone.
```

Bullet points:

- Your old phone will stop making new payments.
- Already scanned payments can still finish.
- Your Oneto balance stays with your account.

Primary button:

```text
Show approval code
```

Secondary button:

```text
I don't have my old phone
```

## 4. New phone approval code screen

Title:

```text
Approve from your old phone
```

Body:

```text
On your old phone, go to Settings -> Move Oneto to a new phone, then scan this code.
```

Waiting text:

```text
Waiting for approval...
```

Success:

```text
Approved. Setting up this phone...
```

Failure:

```text
Approval failed. Try again or contact support.
```

## 5. Old phone approval screen

Title:

```text
Approve new phone?
```

Body:

```text
Only approve if this is your new phone.
```

Bullet points:

- This phone will stop making new payments after the move.
- Your new phone will become your active Oneto phone.
- Already scanned payments can still finish.

PIN prompt label:

```text
Enter your Oneto PIN to approve
```

Primary button:

```text
Approve new phone
```

Secondary button:

```text
Cancel
```

Success:

```text
Done. Your new phone is now active.
```

## 6. Lost phone start screen

Title:

```text
Recover your Oneto account
```

Body:

```text
We'll help you set up Oneto on this phone.
For safety, we need to confirm it's really you first.
```

Bullet points:

- Your points stay with your account.
- Payments may be paused during recovery.
- Already scanned payments may still finish.

Primary button:

```text
Start recovery
```

Secondary button:

```text
I found my old phone
```

## 7. Lost phone questions

Title:

```text
Help us confirm it's you
```

Body:

```text
Answer what you remember. This protects your account from takeover.
```

Fields:

- Do you remember your old Oneto PIN?
- Approximate Oneto balance
- Last place you paid with Oneto
- Last top-up amount
- What happened to your old phone?

Important note:

```text
Never share your email OTP with anyone. Oneto support will not ask for it.
```

Primary button:

```text
Submit recovery request
```

## 8. Recovery submitted

Title:

```text
Recovery request submitted
```

Body:

```text
We're reviewing your request. Payments may stay paused until your account is secured.
```

Status text:

```text
We'll notify you when this phone can be activated.
```

Support text:

```text
Need help? Contact support@getoneto.com.
```

## 9. Recovery approved

Title:

```text
Recovery approved
```

Body:

```text
You can now set up Oneto on this phone.
```

Primary button:

```text
Create new PIN
```

Footer:

```text
For your safety, your old phone can no longer make payments.
```

## 10. Recovery rejected

Title:

```text
Recovery could not be approved
```

Body:

```text
We could not confirm enough details to safely move your account.
```

Primary button:

```text
Contact support
```

Secondary button:

```text
Try again
```

## 11. Stolen phone start screen

Title:

```text
Secure your Oneto account
```

Body:

```text
If your phone was stolen or someone may know your PIN, we'll block the old phone.
```

Bullet points:

- Your account may be paused while we review activity.
- Some offline payments may need review.
- Your points stay protected.

Primary button:

```text
Secure my account
```

Secondary button:

```text
This was only a lost phone
```

## 12. Stolen phone confirmation

Title:

```text
Block old phone?
```

Body:

```text
Use this if your old phone may be unlocked, stolen, or used by someone else.
```

Warning:

```text
Some payments from the old phone may need support review.
```

Primary button:

```text
Yes, block old phone
```

Secondary button:

```text
Cancel
```

## 13. Merchant device move warning

Title:

```text
Sync payments before moving phones
```

Body:

```text
You have payments waiting to sync. Sync them before moving Oneto to a new phone.
```

Primary button:

```text
Sync now
```

Secondary button:

```text
Contact support
```

If no pending payments:

```text
You're ready to move Oneto to a new phone.
```

## 14. Merchant lost phone copy

Title:

```text
Recover merchant access
```

Body:

```text
We need to confirm your business details before activating this phone.
```

Fields:

- Business name
- Settlement bank
- Settlement account name
- Last cashout request, if any
- What happened to the old phone?

Primary button:

```text
Submit merchant recovery
```

## 15. Support scripts

If user asks why recovery is not instant:

```text
Oneto can work offline, so your phone has a secure payment key. We verify recovery carefully so someone cannot take over your account with only email access.
```

If user asks whether their points are gone:

```text
No. Your Oneto points are tied to your account, not just your phone. We need to safely connect your account to this new phone.
```

If user asks about payments made before losing the phone:

```text
If a merchant already scanned the payment, it may still finish when the merchant syncs. If anything looks wrong, support will review it.
```

If user says the phone was stolen:

```text
We'll secure the account first. Some payments from the old phone may need review, but this protects your points from further misuse.
```

If user forgot PIN but still has phone:

```text
For your safety, the PIN protects the payment key on your phone. If the PIN cannot unlock it, we'll help you recover the account on a new setup after verification.
```

## 16. Short in-app explanations

Use these as tooltips or small text.

```text
Your Oneto phone signs payments securely, even offline.
Your PIN unlocks payments on this phone.
Your points stay with your account.
Old scanned payments can still finish after a safe phone move.
If your phone was stolen, we block it to protect your points.
Oneto support will never ask for your OTP.
```

## 17. Words to avoid in user-facing UI

Avoid:

- private key
- public key
- key rotation
- rotation signature
- VERIFY_ONLY
- REVOKED
- cryptographic proof
- Ed25519
- Prisma
- database row

Use instead:

- secure payment key
- linked phone
- move Oneto
- approve this phone
- block old phone
- already scanned payments
- support review
