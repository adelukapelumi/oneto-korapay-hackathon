import { z } from "zod";
import {
  MAX_OFFLINE_TRANSACTION_KOBO,
  CLOCK_SKEW_TOLERANCE_SECONDS,
  ENVELOPE_TTL_SECONDS,
} from "./limits";

/**
 * TransactionEnvelope is the signed payload that represents a payment.
 *
 * Once signed by the sender's Ed25519 private key, it is the authoritative
 * record of intent. Nothing about the transaction may be changed after
 * signing — any mutation invalidates the signature.
 *
 * See CLAUDE.md section 6 for invariants.
 * See CLAUDE.md section 7 for signing and verification rules.
 */

// Regex patterns, inlined to keep this file self-contained for zod.
const USER_ID = /^u_[0-9a-f]{16}$/;
const TX_ID = /^tx_[0-9a-f]{16}$/;
const NONCE = /^[0-9a-f]{32}$/;
const PUB_KEY = /^ed25519:[0-9a-f]{64}$/;
const SIG = /^ed25519:[0-9a-f]{128}$/;

const ISO_DATE = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be ISO 8601 date string",
  });

const MAX_ENVELOPE_TTL_MS = ENVELOPE_TTL_SECONDS * 1000;

function getEnvelopeTtlMs(timestamp: string, expiresAt: string): number {
  return new Date(expiresAt).getTime() - new Date(timestamp).getTime();
}

function hasPositiveTtlWithinLimit(d: {
  timestamp: string;
  expiresAt: string;
}): boolean {
  const ttlMs = getEnvelopeTtlMs(d.timestamp, d.expiresAt);
  return ttlMs > 0 && ttlMs <= MAX_ENVELOPE_TTL_MS;
}

// The "draft" is an envelope before it has a signature.
// This is what gets hashed to produce the transactionId, and what
// gets signed to produce the signature.
export const EnvelopeDraftSchema = z
  .object({
    version: z.literal(1),
    senderUserId: z.string().regex(USER_ID),
    senderPublicKey: z.string().regex(PUB_KEY),
    recipientUserId: z.string().regex(USER_ID),
    amountKobo: z
      .number()
      .int()
      .positive()
      .max(MAX_OFFLINE_TRANSACTION_KOBO, {
        message: `amount exceeds max offline transaction of ${MAX_OFFLINE_TRANSACTION_KOBO} kobo`,
      }),
    senderSequenceNumber: z.number().int().positive(),
    senderBalanceBeforeKobo: z.number().int().nonnegative(),
    senderBalanceAfterKobo: z.number().int().nonnegative(),
    timestamp: ISO_DATE,
    expiresAt: ISO_DATE,
    requestNonce: z.string().regex(NONCE),
  })
  .strict()
  .refine(
    (d) => d.senderBalanceAfterKobo === d.senderBalanceBeforeKobo - d.amountKobo,
    {
      message: "balance math inconsistent: after must equal before minus amount",
      path: ["senderBalanceAfterKobo"],
    },
  )
  .refine((d) => d.senderUserId !== d.recipientUserId, {
    message: "sender and recipient cannot be the same user",
    path: ["recipientUserId"],
  })
  .refine(hasPositiveTtlWithinLimit, {
    message: `expiresAt must be after timestamp and within ${MAX_ENVELOPE_TTL_MS}ms`,
    path: ["expiresAt"],
  });

export type EnvelopeDraft = z.infer<typeof EnvelopeDraftSchema>;

// The full envelope has the draft fields PLUS transactionId and signature.
// transactionId is deterministic from the draft; signature requires a private key.
export const TransactionEnvelopeSchema = z
  .object({
    version: z.literal(1),
    transactionId: z.string().regex(TX_ID),
    senderUserId: z.string().regex(USER_ID),
    senderPublicKey: z.string().regex(PUB_KEY),
    recipientUserId: z.string().regex(USER_ID),
    amountKobo: z.number().int().positive().max(MAX_OFFLINE_TRANSACTION_KOBO),
    senderSequenceNumber: z.number().int().positive(),
    senderBalanceBeforeKobo: z.number().int().nonnegative(),
    senderBalanceAfterKobo: z.number().int().nonnegative(),
    timestamp: ISO_DATE,
    expiresAt: ISO_DATE,
    requestNonce: z.string().regex(NONCE),
    signature: z.string().regex(SIG),
  })
  .strict()
  .refine(
    (d) => d.senderBalanceAfterKobo === d.senderBalanceBeforeKobo - d.amountKobo,
    {
      message: "balance math inconsistent",
      path: ["senderBalanceAfterKobo"],
    },
  )
  .refine((d) => d.senderUserId !== d.recipientUserId, {
    message: "sender and recipient cannot be same user",
    path: ["recipientUserId"],
  })
  .refine(hasPositiveTtlWithinLimit, {
    message: `expiresAt must be after timestamp and within ${MAX_ENVELOPE_TTL_MS}ms`,
    path: ["expiresAt"],
  });

export type TransactionEnvelope = z.infer<typeof TransactionEnvelopeSchema>;

/**
 * Check whether the envelope's timestamps make it valid at "now".
 * Separate from schema validation because "now" is a runtime value.
 */
export function isEnvelopeCurrentlyValid(
  e: TransactionEnvelope | EnvelopeDraft,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const ts = new Date(e.timestamp).getTime();
  const exp = new Date(e.expiresAt).getTime();

  const skewMs = CLOCK_SKEW_TOLERANCE_SECONDS * 1000;

  if (ts > nowMs + skewMs) {
    return { ok: false, reason: "timestamp too far in the future" };
  }
  if (exp <= nowMs) {
    return { ok: false, reason: "envelope has expired" };
  }
  return { ok: true };
}
