import type { AxiosInstance } from "axios";
import { z } from "zod";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

const RecoveryRiskTypeSchema = z.enum(["LOST_DEVICE", "COMPROMISED_DEVICE"]);
const RecoveryReasonSchema = z.enum([
  "NEW_PHONE",
  "LOST_PHONE",
  "STOLEN_PHONE",
  "DAMAGED_PHONE",
  "APP_UNINSTALLED",
  "APP_DATA_CLEARED",
  "FACTORY_RESET",
  "FORGOT_PIN",
  "KEYPAIR_WIPED",
  "OTHER",
]);
const RecoveryStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

const RecoveryRequestSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  oldKeyId: z.string().min(1),
  requestedNewPublicKey: z.string().regex(/^ed25519:[0-9a-f]{64}$/),
  status: RecoveryStatusSchema,
  riskType: RecoveryRiskTypeSchema,
  reason: RecoveryReasonSchema,
  userNotes: z.string().nullable(),
  approximateBalanceKobo: z.string().nullable(),
  lastMerchantText: z.string().nullable(),
  lastTopupAmountKobo: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  decisionNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RecoveryStatusResponseSchema = z.object({
  recoveryRequest: RecoveryRequestSchema.nullable(),
});

export type RecoveryRiskType = z.infer<typeof RecoveryRiskTypeSchema>;
export type RecoveryReason = z.infer<typeof RecoveryReasonSchema>;
export type RecoveryRequestStatus = z.infer<typeof RecoveryStatusSchema>;
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;

export interface CreateRecoveryRequestInput {
  readonly requestedNewPublicKey: string;
  readonly riskType: RecoveryRiskType;
  readonly reason: RecoveryReason;
  readonly userNotes?: string;
  readonly approximateBalanceKobo?: number;
  readonly lastMerchantText?: string;
  readonly lastTopupAmountKobo?: number;
}

export function shouldRedirectToRecoveryStatus(
  request: RecoveryRequest | null,
): boolean {
  return request?.status === "PENDING" || request?.status === "APPROVED";
}

async function parseOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): Promise<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      "Server returned an unexpected response shape",
      0,
      "SCHEMA_MISMATCH",
    );
  }
  return parsed.data;
}

export async function createRecoveryRequest(
  input: CreateRecoveryRequestInput,
  client: AxiosInstance = apiClient,
): Promise<RecoveryRequest> {
  try {
    const res = await client.post<unknown>("/recovery/request", input);
    return await parseOrThrow(RecoveryRequestSchema, res.data);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

export async function getRecoveryStatus(
  client: AxiosInstance = apiClient,
): Promise<RecoveryRequest | null> {
  try {
    const res = await client.get<unknown>("/recovery/status");
    const parsed = await parseOrThrow(RecoveryStatusResponseSchema, res.data);
    return parsed.recoveryRequest;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

export async function cancelRecoveryRequest(
  id: string,
  client: AxiosInstance = apiClient,
): Promise<RecoveryRequest> {
  try {
    const res = await client.post<unknown>(`/recovery/${id}/cancel`);
    return await parseOrThrow(RecoveryRequestSchema, res.data);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
