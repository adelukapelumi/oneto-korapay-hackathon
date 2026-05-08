import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const LedgerEntrySchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  type: z.enum(["DEBIT", "CREDIT"]),
  amountKobo: z.string(),
  balanceAfterKobo: z.string(),
  description: z.string(),
  createdAt: z.string(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

const LedgerResponseSchema = z.object({
  entries: z.array(LedgerEntrySchema),
  nextCursor: z.string().nullable(),
});

export type LedgerResponse = z.infer<typeof LedgerResponseSchema>;

export async function fetchLedger(
  cursor?: string,
  limit: number = 20,
): Promise<LedgerResponse> {
  try {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) params.cursor = cursor;

    const res = await apiClient.get("/me/ledger", { params });
    const parsed = LedgerResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
