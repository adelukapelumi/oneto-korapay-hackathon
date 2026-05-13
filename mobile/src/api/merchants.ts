import { z } from "zod";
import type { AxiosInstance } from "axios";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const MerchantSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
});

const MerchantsResponseSchema = z.object({
  merchants: z.array(MerchantSchema),
});

export type MerchantListItem = z.infer<typeof MerchantSchema>;

export async function fetchActiveMerchants(
  client: AxiosInstance = apiClient,
): Promise<MerchantListItem[]> {
  try {
    const res = await client.get<unknown>("/merchants/list");
    const parsed = MerchantsResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new ApiError(
        "Server returned an unexpected response shape",
        0,
        "SCHEMA_MISMATCH",
      );
    }
    return parsed.data.merchants;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

