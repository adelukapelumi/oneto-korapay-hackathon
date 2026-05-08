// Bridge between a scanned PaymentRequest and the shared signEnvelope function.
//
// This module is security-critical. It:
//   1. Computes the student's spendable balance from SQLite local state
//   2. Checks balance sufficiency before signing anything
//   3. Constructs the EnvelopeDraft with the correct fields
//   4. Delegates signing to @oneto/shared (no rolling our own crypto)
//
// The caller (confirm screen) is responsible for:
//   - Calling loadAndDecryptKeypair(pin) to get the private key
//   - Zeroing the private key immediately after this function returns:
//       result; // use it
//       privateKey.fill(0); // zero immediately after
//   - Persisting the returned envelope to SQLite via insertPendingTransaction
//
// Security properties preserved here:
//   - No signing if balance is insufficient (prevents overdraft claim)
//   - Balance math enforced by EnvelopeDraftSchema inside signEnvelope
//   - Sequence number comes from local ledger (monotonic per device)
//   - requestNonce from merchant ties this envelope to a specific request
//     (prevents the student from reusing a signed envelope for a different merchant)

import { signEnvelope } from "@oneto/shared";
import type { EnvelopeDraft, TransactionEnvelope, PaymentRequest } from "@oneto/shared";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "@oneto/shared";
import {
  getNextSequenceNumber,
  sumPendingOutgoingKobo,
  getLocalState,
} from "../ledger/db";

// ----------------------------------------------------------------
// Custom errors
// ----------------------------------------------------------------

/**
 * Thrown when the student's spendable balance is less than the requested amount.
 *
 * spendableBalance = verifiedBalanceKobo (from server) - sumPendingOutgoingKobo (local)
 */
export class InsufficientBalanceError extends Error {
  public readonly available: number;
  public readonly requested: number;

  constructor(available: number, requested: number) {
    super(
      `Insufficient balance: ${available} kobo available, ${requested} kobo requested`,
    );
    this.name = "InsufficientBalanceError";
    this.available = available;
    this.requested = requested;
  }
}

// ----------------------------------------------------------------
// Main function
// ----------------------------------------------------------------

export interface BuildEnvelopeInput {
  /** Parsed and validated PaymentRequest from the merchant's QR. */
  paymentRequest: PaymentRequest;
  /** The student's userId (from Me.id). */
  senderUserId: string;
  /** The student's public key string (ed25519:... format). */
  senderPublicKey: string;
  /**
   * The student's decrypted Ed25519 private key (32 bytes).
   * The caller MUST zero this buffer immediately after this function returns.
   */
  privateKey: Uint8Array;
}

/**
 * Build and sign a TransactionEnvelope for an offline payment.
 *
 * Throws:
 *   - Error("No verified balance...") — if GET /me has never been called
 *   - InsufficientBalanceError — if spendable < requested
 *   - ZodError — if the constructed draft fails schema validation (invariant violation)
 *
 * @returns The fully signed TransactionEnvelope, ready to be displayed as a QR.
 */
export function buildAndSignEnvelope(
  input: BuildEnvelopeInput,
): TransactionEnvelope {
  const { paymentRequest, senderUserId, senderPublicKey, privateKey } = input;

  // 1. Read server-verified balance from local state.
  //    If null, the app hasn't completed a successful GET /me call yet.
  //    The student must be online at least once before making payments.
  const verifiedBalanceRaw = getLocalState("verified_balance_kobo");
  if (verifiedBalanceRaw === null) {
    throw new Error(
      "No verified balance stored locally. Open the app while online to sync your balance before making payments.",
    );
  }

  // parseInt with base 10. The stored value was originally user.verifiedBalanceKobo
  // (a string-encoded integer from the server). Safe to parse as Number for pilot
  // balances — MAX_USER_BALANCE_KOBO (5_000_000) is far below MAX_SAFE_INTEGER.
  const verifiedBalance = parseInt(verifiedBalanceRaw, 10);
  if (Number.isNaN(verifiedBalance) || !Number.isInteger(verifiedBalance)) {
    throw new Error(
      `Stored verified_balance_kobo is not a valid integer: "${verifiedBalanceRaw}"`,
    );
  }

  // 2. Compute spendable balance: server balance minus locally-tracked pending debits.
  //    This is the student's best estimate of what they can spend offline.
  //    The server will re-verify at reconciliation time (CLAUDE.md §7.3 step 9).
  const pendingOutgoing = sumPendingOutgoingKobo();
  const spendableBalance = verifiedBalance - pendingOutgoing;

  // 3. Check sufficient balance before signing.
  //    The envelope's senderBalanceBeforeKobo is a CLAIM by the student.
  //    We still enforce it locally to catch honest mistakes and warn the user.
  if (spendableBalance < paymentRequest.amountKobo) {
    throw new InsufficientBalanceError(spendableBalance, paymentRequest.amountKobo);
  }

  // 4. Get sequence number. This is unique per outgoing envelope on this device.
  //    The server enforces global uniqueness per sender across all time.
  const sequenceNumber = getNextSequenceNumber();

  // 5. Build the draft. All fields are validated by EnvelopeDraftSchema inside
  //    signEnvelope (Zod strict parse). If any invariant fails, signEnvelope throws.
  const now = new Date();
  const draft: EnvelopeDraft = {
    version: 1,
    senderUserId,
    senderPublicKey,
    recipientUserId: paymentRequest.merchantId,
    amountKobo: paymentRequest.amountKobo,
    senderSequenceNumber: sequenceNumber,
    senderBalanceBeforeKobo: spendableBalance,
    senderBalanceAfterKobo: spendableBalance - paymentRequest.amountKobo,
    timestamp: now.toISOString(),
    // Envelope expires 60 seconds after creation. Server checks this at reconcile.
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    requestNonce: paymentRequest.requestNonce,
  };

  // 6. Sign. signEnvelope validates the draft internally before signing.
  //    The private key must be 32 raw bytes — enforced by tweetnacl.
  //    The caller zeros privateKey immediately after this returns.
  return signEnvelope(draft, privateKey);
}

// Re-export for convenience so callers don't need a separate import
export { MAX_OFFLINE_TRANSACTION_KOBO };
