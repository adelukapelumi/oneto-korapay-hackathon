import { z } from "zod";
import { apiClient } from "./client";

const OutgoingStatusSchema = z.object({
  transactionId: z.string(),
  status: z.enum([
    "reconciled",
    "rejected",
    "expired_unclaimed",
    "unknown_pending",
  ]),
  reason: z.string().optional(),
  claimDeadlineAt: z.string().optional(),
});

const OutgoingStatusResponseSchema = z.array(OutgoingStatusSchema);

export type OutgoingStatus = z.infer<typeof OutgoingStatusSchema>;

export async function fetchOutgoingStatuses(
  transactions: ReadonlyArray<{
    transactionId: string;
    signedEnvelope: unknown;
  }>,
): Promise<OutgoingStatus[]> {
  const response = await apiClient.post("/reconcile/status", { transactions });
  return OutgoingStatusResponseSchema.parse(response.data);
}
