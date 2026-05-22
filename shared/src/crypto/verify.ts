import * as ed from "@noble/ed25519";
import {
  TransactionEnvelope,
  TransactionEnvelopeSchema,
  isEnvelopeCurrentlyValid,
} from "../types/envelope";
import { CLOCK_SKEW_TOLERANCE_SECONDS } from "../types/limits";
import { canonicalizeToBytes } from "./canonicalize";
import { publicKeyFromString } from "./keys";
import { fromHex } from "./keys";
import { PublicKeyString } from "../types/branded";
import { computeTransactionId } from "./sign";

/**
 * Result of verifying an envelope.
 *
 * On failure, `reason` is for server-side logging only.
 * NEVER return the reason verbatim to the client — it can leak information
 * useful to attackers. Map to a generic error at the API boundary.
 */
export type VerifyResult =
  | { ok: true; envelope: TransactionEnvelope }
  | { ok: false; reason: VerifyFailureReason };

export type VerifyFailureReason =
  | "schema_invalid"
  | "public_key_mismatch"
  | "timestamp_out_of_window"
  | "transaction_id_mismatch"
  | "signature_invalid";

export interface VerifyEnvelopeOptions {
  readonly allowExpiredEnvelope?: boolean;
}

/**
 * Verify an envelope received from a client.
 *
 * @param input  The claimed envelope. Untrusted input — treat as hostile.
 * @param registeredPublicKey  The public key the server has on file for
 *                             the claimed senderUserId. This is the
 *                             source of truth, not the key in the envelope.
 * @param nowMs  Current time in ms, injectable for tests.
 */
export function verifyEnvelope(
  input: unknown,
  registeredPublicKey: PublicKeyString,
  nowMs: number = Date.now(),
  options: VerifyEnvelopeOptions = {},
): VerifyResult {
  // 1. Schema validation. Rejects malformed input, wrong types,
  //    out-of-range values, and balance math violations.
  const parsed = TransactionEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid" };
  }
  const envelope = parsed.data;

  // 2. Public key bound to account must match the envelope's claim.
  //    Defends against: attacker uses their own valid signature but
  //    claims to be another user.
  if (envelope.senderPublicKey !== registeredPublicKey) {
    return { ok: false, reason: "public_key_mismatch" };
  }

  // 3. Timestamp window check.
  // Default behaviour enforces short QR freshness (`expiresAt`).
  // Reconcile can opt out of the expiry check because settlement uses a
  // separate backend claim window derived from the signed timestamp.
  if (options.allowExpiredEnvelope) {
    const timestampMs = new Date(envelope.timestamp).getTime();
    const futureSkewMs = CLOCK_SKEW_TOLERANCE_SECONDS * 1000;
    if (timestampMs > nowMs + futureSkewMs) {
      return { ok: false, reason: "timestamp_out_of_window" };
    }
  } else {
    const timingOk = isEnvelopeCurrentlyValid(envelope, nowMs);
    if (!timingOk.ok) {
      return { ok: false, reason: "timestamp_out_of_window" };
    }
  }

  // 4. Transaction ID must match the deterministic hash of the draft.
  //    Defends against: attacker mutates transactionId to avoid dedup.
  const {
    transactionId: claimedTxId,
    signature: _discard,
    ...draft
  } = envelope;
  const expectedTxId = computeTransactionId(draft);
  if (claimedTxId !== expectedTxId) {
    return { ok: false, reason: "transaction_id_mismatch" };
  }

  // 5. Signature verification. This is the cryptographic core.
  //    The signed message is canonicalize(envelope-without-signature).
  const signedObject = { ...draft, transactionId: expectedTxId };
  const messageBytes = canonicalizeToBytes(signedObject);
  const sigHex = envelope.signature.slice("ed25519:".length);
  const sigBytes = fromHex(sigHex);
  const pubBytes = publicKeyFromString(registeredPublicKey);

  let sigOk = false;
  try {
    sigOk = ed.verify(sigBytes, messageBytes, pubBytes);
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return { ok: false, reason: "signature_invalid" };
  }

  return { ok: true, envelope };
}
