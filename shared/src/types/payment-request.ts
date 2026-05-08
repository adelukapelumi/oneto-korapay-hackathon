import { z } from "zod";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "./limits";

/**
 * PaymentRequest is the payload inside a merchant's request QR code.
 *
 * The merchant app generates this; the student app scans and validates it.
 * Strict Zod schema is the first line of defense against tampered QR codes:
 *   - merchantId must match user-ID format (u_ + 16 hex)
 *   - amountKobo is capped at MAX_OFFLINE_TRANSACTION_KOBO (₦2,000)
 *   - requestNonce is 32 hex chars (128 bits) — used in the envelope to
 *     tie the signed payment back to this specific request
 *   - createdAt must parse as a valid date (ISO 8601)
 *
 * Threat: attacker crafts a QR with amountKobo: 999999999 or a fake merchantId.
 * Defense: schema rejects amounts over the cap before the UI is shown;
 *          merchantId format check means only valid IDs can reach signing.
 */

const USER_ID = /^u_[0-9a-f]{16}$/;
const NONCE = /^[0-9a-f]{32}$/;

export const PaymentRequestSchema = z
  .object({
    version: z.literal(1),
    merchantId: z.string().regex(USER_ID, {
      message: "merchantId must match u_ + 16 hex chars",
    }),
    amountKobo: z
      .number()
      .int()
      .positive()
      .max(MAX_OFFLINE_TRANSACTION_KOBO, {
        message: `amountKobo exceeds maximum offline transaction of ${MAX_OFFLINE_TRANSACTION_KOBO} kobo`,
      }),
    requestNonce: z.string().regex(NONCE, {
      message: "requestNonce must be 32 lowercase hex characters",
    }),
    merchantLabel: z.string().max(100).optional(),
    createdAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "createdAt must be an ISO 8601 date string",
    }),
  })
  .strict();

export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;
