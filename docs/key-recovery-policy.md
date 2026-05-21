# Oneto Key and Device Recovery Policy

Status: Target policy for implementation  
Owner: Oneto engineering / founder operations  
Scope: student accounts, merchant accounts, device changes, lost devices, stolen devices, and offline payment verification

---

## 1. Why this policy exists

Oneto uses signed offline payment envelopes.

A student payment QR is not just a display code. It is a signed payment instruction created by the student's device private key. The server later verifies that signature using the public key registered for that user.

This means device recovery is not a normal login problem.

Email OTP proves control of the email inbox. It does not prove control of the old Oneto device key.

PIN proves local app unlock on a device. It does not replace the private key.

The private key is the authority that signs payments. The public key is the server-side verifier.

Therefore, replacing a user's payment device must be handled carefully.

---

## 2. Identity model

Oneto uses four related identities:

1. Email address  
   The login identifier. For students, this should normally be their CU student email.

2. User ID  
   The internal account identity stored in the database.

3. Device keypair  
   The payment identity for a device:
   - private key: stored only on the user's device
   - public key: stored on the server

4. PIN  
   The local unlock secret used to decrypt and use the private key on that device.

The PIN is not the payment identity. The private key is.

Target rule:

```text
One user account has one ACTIVE payment device at a time.
Old device keys may remain temporarily as VERIFY_ONLY to complete already-created offline payments.
```

## 3. Key terms

### Private key

The secret signing key stored only on the user's device.

Oneto servers must never store, transmit, log, or request the private key.

### Public key

The verifier key stored by Oneto.

It allows the server to check whether a payment envelope was signed by the matching private key.

The public key cannot create payments.

### Payment envelope

The signed payment record contained in a QR code.

It includes details such as sender, recipient, amount, timestamp, expiry, sequence number, and signature.

### Signature

Cryptographic proof that a specific private key approved a specific message.

For normal payments, the private key signs the payment envelope.

For device transfer, the old private key signs approval for the new public key.

### Rotation

Rotation means changing the active payment keypair for a user.

In product language, this is "moving Oneto to a new phone."

In database terms, the target implementation must not simply overwrite `User.publicKey`. It must keep key history and mark key status.

## 4. Target key states

The target implementation must support device key history.

Each device key must have one of these statuses:

### ACTIVE

The current key for the account.

An ACTIVE key can:

- sign new payments
- verify payments signed by that device
- approve a normal move to a new device

Only one ACTIVE key is allowed per user.

### VERIFY_ONLY

A retired key kept only for old offline payments.

A VERIFY_ONLY key cannot be used for new payments.

The server may still verify an old payment envelope signed by this key if:

- the key belongs to the sender
- the envelope timestamp is before the key was retired
- the envelope is still within Oneto's allowed reconciliation rules
- the sender sequence number has not already been used
- the sender has enough server-side balance
- the account is not blocked in a way that forbids settlement

### REVOKED

A blocked key.

A REVOKED key must not be accepted for normal reconciliation.

Use REVOKED when the old device may be compromised, for example:

- phone stolen while unlocked
- user says someone knows their Oneto PIN
- suspicious or unauthorized payments are reported
- support cannot trust old-device activity

Payments involving a REVOKED key require manual dispute review.

## 5. Normal first-time setup

User story:

Student A downloads Oneto.  
Student A enters `studenta@stu.cu.edu.ng`.  
OTP succeeds.  
Student A creates a 6-digit PIN.  
The app generates an Ed25519 keypair.  
The private key is encrypted under the PIN and stored locally.  
The public key is registered with Oneto.  
Student A can now top up and pay approved merchants.

Rules:

- First key registration is allowed only if the user has no existing ACTIVE key.
- The server stores only the public key.
- The private key remains on the device.
- The PIN unlocks the private key locally.
- The PIN must not be used as the sole authority for account recovery.

## 6. Normal device move when the old phone is available

This is the safest device change path.

User story:

Student A buys a new phone.  
Student A still has the old phone.  
Student A logs into Oneto on the new phone.  
Oneto says the account is already linked to another phone.  
Student A chooses "I still have my old phone."  
The new phone creates a new keypair and shows an approval QR/code.  
Student A opens Oneto on the old phone, enters PIN, and approves the new phone.  
The old private key signs approval for the new public key.  
The server verifies that approval using the old public key.  
The old key becomes VERIFY_ONLY.  
The new key becomes ACTIVE.

Rules:

- The old phone must approve the new public key using the old private key.
- The PIN is used only to unlock the old private key locally.
- The old key must not be deleted immediately.
- The old key becomes VERIFY_ONLY so already-scanned offline payments can still reconcile.
- The old phone must stop creating new payments after the move.

User-facing language must avoid "rotation" and say "move Oneto to this phone."

## 7. Lost phone recovery

A lost phone means:

The user no longer has the old phone, but there is no clear evidence that another person can unlock Oneto or use the old private key.

Examples:

- phone misplaced
- phone damaged
- phone factory reset
- app deleted and private key lost
- user forgot PIN and keypair was wiped after too many wrong attempts

Target flow:

User logs in with email OTP on new phone.  
Server sees the account already has an ACTIVE key.  
App says the account is linked to another phone.  
User chooses "I lost my old phone."  
A recovery request is created.  
Account is restricted while recovery is reviewed.  
Support verifies identity and risk.  
If approved:
- old key becomes VERIFY_ONLY
- new key becomes ACTIVE
If rejected:
- no new key is activated

Minimum recovery checks for students:

- email OTP succeeded
- user provides old PIN if remembered
- user confirms approximate current balance
- user confirms recent top-up or recent merchant activity
- no obvious suspicious activity
- support records reason and decision

Minimum recovery checks for merchants:

- email OTP succeeded
- business name confirmed
- settlement account name/bank confirmed
- recent cashout or transaction activity confirmed
- founder/admin approval required

Rules:

- Email OTP alone must not replace the payment key.
- Old PIN alone must not replace the payment key.
- Email OTP plus PIN is still not enough by itself for high-risk accounts.
- A lost-phone recovery normally moves the old key to VERIFY_ONLY, not REVOKED.
- If suspicious facts appear during recovery, treat the case as compromised instead.

## 8. Stolen or compromised phone

A compromised phone means:

Oneto cannot safely trust future or recent activity from the old device.

Examples:

- phone stolen while unlocked
- user says someone knows their Oneto PIN
- user reports unauthorized payments
- unusual payment activity appears after loss
- merchant/user dispute suggests abuse
- support is not confident the old key should remain trusted

Target flow:

User logs in with email OTP or contacts support.  
User chooses "My phone was stolen" or support marks the case compromised.  
Account is restricted immediately.  
Old key becomes REVOKED or pending revocation.  
New key can become ACTIVE only after recovery approval.  
Old offline payments may require dispute review.

Rules:

- Do not keep a compromised key as VERIFY_ONLY automatically.
- Reconciliation involving a compromised key requires stricter treatment.
- If Oneto cannot distinguish lost from compromised, choose the safer path: restrict and review.

## 9. Offline payment treatment during device changes

Oneto must distinguish these cases.

### QR generated but merchant did not scan

No payment exists outside the student's lost device.

If the device is lost, this QR is gone.

No server balance should change.

### QR generated and merchant scanned

The merchant device has the signed envelope.

The payment may still reconcile if:

- the old public key remains available for verification
- the old key is VERIFY_ONLY, not deleted
- the envelope was created before the key was retired
- normal reconciliation checks pass

This is why old public keys must not be casually deleted.

### Merchant has unsynced scanned payments

Merchant device changes are higher risk than student device changes.

If a merchant has unsynced scanned payments, the app should block or strongly warn before device transfer.

Target merchant rule:

Merchants must sync pending payments before changing devices or requesting cashout.

## 10. What the app should show

The app should not teach cryptography during onboarding.

Use simple language.

When the server says the account already has a key:

```text
This Oneto account is already linked to another phone.

To protect your points, we need to confirm before setting up this phone.
```

Buttons:

- I still have my old phone
- I lost my old phone
- My phone was stolen

For old-phone move:

```text
Approve this phone from your old phone.

Your old phone will stop making new payments after the move.
Already scanned payments can still finish.
```

For lost phone:

```text
We'll help you recover access.

For safety, payments may be paused while we confirm it's really you.
Already scanned payments may still finish.
```

For stolen phone:

```text
We'll secure your account now.

The old phone will be blocked. Some offline payments may need review.
```

## 11. What support/admin must record

Every recovery case must record:

- recovery request ID
- user ID
- email
- role: student, merchant, or admin
- current key status before recovery
- declared reason: moving phone, lost phone, stolen phone, forgot PIN, app reset
- whether old phone is available
- whether old PIN is known
- whether suspicious activity was reported
- identity checks performed
- support/admin decision
- old key final status: VERIFY_ONLY or REVOKED
- new key ID/public key
- timestamps
- approving admin/founder ID

No recovery should happen without an audit trail.

## 12. Required implementation target

The current one-key model must be replaced by device key history.

Target backend model:

`UserDeviceKey`
- `id`
- `userId`
- `publicKey`
- `status: ACTIVE | VERIFY_ONLY | REVOKED`
- `validFrom`
- `retiredAt`
- `verifyUntil`
- `createdAt`
- `updatedAt`
- `createdByRecoveryRequestId`

Target recovery model:

`KeyRecoveryRequest`
- `id`
- `userId`
- `requestedNewPublicKey`
- `reason`
- `status: PENDING | APPROVED | REJECTED | CANCELLED`
- `riskType: NORMAL_MOVE | LOST_DEVICE | COMPROMISED_DEVICE`
- `oldKeyId`
- `approvedByUserId`
- `approvedAt`
- `rejectedAt`
- `decisionNotes`
- `createdAt`
- `updatedAt`

Target backend behavior:

- first-time setup creates first ACTIVE key
- normal move requires old-key approval signature
- lost-device recovery requires recovery approval
- compromised-device recovery revokes old key
- reconciliation verifies against device-key history, not a single `User.publicKey`

## 13. Non-negotiable safety rules

- Never store private keys on the server.
- Never log private keys.
- Never treat email OTP alone as enough to replace a payment key.
- Never treat PIN alone as enough to replace a payment key.
- Never delete an old public key if old offline payments may still need verification.
- Never allow more than one ACTIVE key per user unless multi-device support is deliberately implemented.
- Never allow a REVOKED key to pass normal reconciliation.
- Never manually edit balances to resolve a key recovery dispute.
- Never enable student-to-student transfers or student cashout as part of recovery.
- Never allow unapproved merchants to receive payments.

## 14. Current implementation gap

Current code only partially implements this policy.

Current known state:

- mobile creates and stores a PIN-protected keypair
- backend stores a single public key on the `User` record
- backend requires a rotation signature when replacing that public key
- lost-device recovery is currently support/manual
- old public key history is not yet implemented
- recovery request records are not yet implemented
- user-facing recovery screens are not yet complete

Until this policy is fully implemented, key recovery must be handled manually and conservatively.
