import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const InitiateTopupResponseSchema = z.object({
  reference: z.string(),
  paymentUrl: z.string().url(),
});

const TopupStatusResponseSchema = z.object({
  reference: z.string(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "EXPIRED"]),
  amountKobo: z.string().regex(/^\d+$/),
});

export type InitiateTopupResponse = z.infer<typeof InitiateTopupResponseSchema>;
export type TopupStatusResponse = z.infer<typeof TopupStatusResponseSchema>;

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

export async function fetchTopupStatus(
  reference: string,
): Promise<TopupStatusResponse> {
  try {
    const res = await apiClient.get(`/topup/status/${encodeURIComponent(reference)}`);
    const parsed = TopupStatusResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError("Unexpected response from server", 0, "SCHEMA_MISMATCH");
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
