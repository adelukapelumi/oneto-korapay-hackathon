import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  EnvelopeDraft,
  TransactionEnvelope,
  EnvelopeDraftSchema,
} from "../types/envelope";
import { canonicalize, canonicalizeToBytes } from "./canonicalize";
import { toHex } from "./keys";
import {
  toTransactionId,
  toSignatureString,
  TransactionId,
} from "../types/branded";

/**
 * Sign an envelope draft with the sender's Ed25519 private key.
 *
 * Flow:
 *   1. Validate the draft against schema (catches invariant violations early).
 *   2. Compute transactionId = first 16 hex chars of SHA-256(canonical(draft)).
 *   3. Sign canonical(draft + transactionId) with privateKey.
 *   4. Return the full envelope.
 *
 * The transactionId is deterministic — the same draft always yields the
 * same transactionId. This gives us a stable ID for dedup and auditing.
 */
export function signEnvelope(
  draftInput: EnvelopeDraft,
  privateKey: Uint8Array,
): TransactionEnvelope {
  // Revalidate — callers should have validated already, but defense in depth.
  const draft = EnvelopeDraftSchema.parse(draftInput);

  const transactionId = computeTransactionId(draft);

  // The signed object includes the transactionId so that the ID itself
  // is covered by the signature. Otherwise an attacker could change
  // transactionId without invalidating the signature.
  const signedObject = {
    ...draft,
    transactionId,
  };

  const messageBytes = canonicalizeToBytes(signedObject);
  const signatureBytes = ed.sign(messageBytes, privateKey);
  const signature = toSignatureString("ed25519:" + toHex(signatureBytes));

  return {
    ...signedObject,
    signature,
  };
}

export function computeTransactionId(draft: EnvelopeDraft): TransactionId {
  const canonical = canonicalize(draft);
  const bytes = new TextEncoder().encode(canonical);
  const hash = sha256(bytes);
  const hex = toHex(hash).slice(0, 16);
  return toTransactionId("tx_" + hex);
}