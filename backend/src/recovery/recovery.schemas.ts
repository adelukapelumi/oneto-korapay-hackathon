import { z } from "zod";

const PublicKeySchema = z
  .string()
  .regex(/^ed25519:[0-9a-f]{64}$/);

const OptionalTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional();

const OptionalKoboSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .optional();

export const CreateRecoveryRequestSchema = z
  .object({
    requestedNewPublicKey: PublicKeySchema,
    riskType: z.enum(["LOST_DEVICE", "COMPROMISED_DEVICE"]),
    reason: z.enum([
      "LOST_PHONE",
      "STOLEN_PHONE",
      "DAMAGED_PHONE",
      "APP_UNINSTALLED",
      "APP_DATA_CLEARED",
      "FACTORY_RESET",
      "FORGOT_PIN",
      "KEYPAIR_WIPED",
      "OTHER",
    ]),
    userNotes: OptionalTextSchema,
    approximateBalanceKobo: OptionalKoboSchema,
    lastMerchantText: OptionalTextSchema,
    lastTopupAmountKobo: OptionalKoboSchema,
  })
  .strict();

export const RecoveryIdParamSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const ApproveRecoveryRequestSchema = z
  .object({
    decisionNotes: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const RejectRecoveryRequestSchema = z
  .object({
    decisionNotes: z.string().trim().min(1).max(2000),
  })
  .strict();

export type CreateRecoveryRequestDto = z.infer<typeof CreateRecoveryRequestSchema>;
export type RecoveryIdParamDto = z.infer<typeof RecoveryIdParamSchema>;
export type ApproveRecoveryRequestDto = z.infer<typeof ApproveRecoveryRequestSchema>;
export type RejectRecoveryRequestDto = z.infer<typeof RejectRecoveryRequestSchema>;
