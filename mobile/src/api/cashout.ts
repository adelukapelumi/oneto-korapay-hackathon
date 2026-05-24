import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const CashoutSchema = z.object({
  id: z.string(),
  amountKobo: z.string(),   // BigInt serialized as string
  grossAmountKobo: z.string(),
  onetoFeeBps: z.number(),
  onetoFeeKobo: z.string().nullable(),
  korapayPayoutFeeKobo: z.string().nullable(),
  korapayPayoutFeeBearer: z.string(),
  korapayPayoutFeeDeductedFromRecipient: z.boolean().nullable(),
  netPayoutKobo: z.string().nullable(),
  korapayTransferAmountKobo: z.string().nullable(),
  status: z.string(),        // PENDING, PROCESSING, COMPLETED, FAILED
  requestedAt: z.string(),
});

const RequestCashoutResponseSchema = z.object({
  cashout: CashoutSchema,
});

const CashoutStatusResponseSchema = z.object({
  cashouts: z.array(CashoutSchema),
});

export type Cashout = z.infer<typeof CashoutSchema>;

export async function requestCashout(): Promise<Cashout> {
  try {
    const res = await apiClient.post("/cashout/request");
    const parsed = RequestCashoutResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data.cashout;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

export async function getCashoutStatus(): Promise<Cashout[]> {
  try {
    const res = await apiClient.get("/cashout/status");
    const parsed = CashoutStatusResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data.cashouts;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
