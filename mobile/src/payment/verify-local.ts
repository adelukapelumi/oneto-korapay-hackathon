import { verifyEnvelope, TransactionEnvelopeSchema } from "@oneto/shared";
import type { VerifyResult, TransactionEnvelope, PublicKeyString } from "@oneto/shared";

export type LocalVerifyResult =
  | { ok: true; envelope: TransactionEnvelope }
  | { ok: false; reason: string };

/**
 * Verify a scanned envelope locally on the merchant's device.
 *
 * This does NOT prove the sender's public key is registered with the server.
 * That check happens at reconcile time. What this DOES prove:
 *   - Envelope shape is valid
 *   - Timestamps are within window
 *   - TransactionId matches the deterministic hash
 *   - Signature is valid for the embedded public key
 */
export function verifyEnvelopeLocally(
  input: unknown,
  nowMs: number = Date.now(),
): LocalVerifyResult {
  // Preliminary parse to extract the embedded public key
  const parsed = TransactionEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "Invalid envelope format" };
  }

  // Full verification using the envelope's own public key.
  // Key-to-account binding (step 2 in verifyEnvelope) is a tautology here
  // — intentional for offline use.
  const verifyResult = verifyEnvelope(input, parsed.data.senderPublicKey as PublicKeyString, nowMs);
  
  if (!verifyResult.ok) {
    return verifyResult;
  }
  
  return { ok: true, envelope: parsed.data };
}
