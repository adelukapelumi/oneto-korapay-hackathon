import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const InitiateTopupResponseSchema = z.object({
  reference: z.string(),
  paymentUrl: z.string().url(),
});

export type InitiateTopupResponse = z.infer<typeof InitiateTopupResponseSchema>;

export async function initiateTopup(
  amountKobo: number,
): Promise<InitiateTopupResponse> {
  try {
    const res = await apiClient.post("/topup/korapay/initiate", { amountKobo });
    const parsed = InitiateTopupResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response from server", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
