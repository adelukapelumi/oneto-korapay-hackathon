import { z } from "zod";

export const CASHOUT_PAYOUT_MODE_VALUES = ["korapay_api", "manual"] as const;
export type CashoutPayoutMode = (typeof CASHOUT_PAYOUT_MODE_VALUES)[number];

const ManualPayoutRequiredSchema = z.object({
  source: z.literal("manual_payout_required"),
  payoutMode: z.literal("manual"),
  amountToPayKobo: z.string(),
  approvedByUserId: z.string(),
  approvedAt: z.string(),
  manualPayoutResponse: z
    .object({
      source: z.literal("manual_payout"),
      externalReference: z.string(),
      note: z.string().nullable(),
      markedPaidByUserId: z.string(),
      markedPaidAt: z.string(),
    })
    .optional(),
}).passthrough();

export type ManualPayoutRequiredMetadata = z.infer<typeof ManualPayoutRequiredSchema>;

export function getCashoutPayoutMode(rawMode: string | undefined): CashoutPayoutMode {
  return rawMode === "manual" ? "manual" : "korapay_api";
}

export function parseManualPayoutRequiredMetadata(
  payload: unknown,
): ManualPayoutRequiredMetadata | null {
  const parsed = ManualPayoutRequiredSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function buildManualPayoutRequiredMetadata(input: {
  readonly amountToPayKobo: bigint;
  readonly approvedByUserId: string;
  readonly approvedAtIso: string;
}): ManualPayoutRequiredMetadata {
  return {
    source: "manual_payout_required",
    payoutMode: "manual",
    amountToPayKobo: input.amountToPayKobo.toString(),
    approvedByUserId: input.approvedByUserId,
    approvedAt: input.approvedAtIso,
  };
}

export function withManualPayoutResponse(
  existing: ManualPayoutRequiredMetadata,
  input: {
    readonly externalReference: string;
    readonly note: string | null;
    readonly markedPaidByUserId: string;
    readonly markedPaidAtIso: string;
  },
): ManualPayoutRequiredMetadata {
  return {
    ...existing,
    manualPayoutResponse: {
      source: "manual_payout",
      externalReference: input.externalReference,
      note: input.note,
      markedPaidByUserId: input.markedPaidByUserId,
      markedPaidAt: input.markedPaidAtIso,
    },
  };
}
