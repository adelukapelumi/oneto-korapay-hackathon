import { z } from "zod";
import type { AxiosInstance } from "axios";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

// Zod response schemas — the source of truth for what we accept from the
// backend. If the backend's shape changes, only this file needs to change.
//
// The backend's actual responses, verified against
// backend/src/auth/auth.controller.ts on 2026-05-02:
//   POST /auth/otp/request  →  { success: true, message: string }
//   POST /auth/otp/verify   →  { success: true, accessToken: string }
//
// Note the verify response does NOT include a user object — the brief's
// expected shape was wrong. We fetch the user separately via GET /me.

const RequestOtpResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

const VerifyOtpResponseSchema = z.object({
  success: z.literal(true),
  accessToken: z.string().min(10),
});

export type RequestOtpResponse = z.infer<typeof RequestOtpResponseSchema>;
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponseSchema>;

// Matches GET /me from backend/src/me/me.controller.ts.
// Balance fields are serialized as strings because they are BigInts on the
// backend (kobo can exceed JS Number.MAX_SAFE_INTEGER).
const UserRoleSchema = z.enum(["STUDENT", "MERCHANT", "ADMIN"]);
const UserStatusSchema = z.enum([
  "ACTIVE",
  "PENDING_VERIFICATION",
  "FROZEN",
  "FLAGGED",
]);

const MeResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  verifiedBalanceKobo: z.string(),
  availableBalanceKobo: z.string(),
  recoveryHeldBalanceKobo: z.string(),
  recoveryHoldUntil: z.string().nullable(),
  createdAt: z.string(),
});

export type Me = z.infer<typeof MeResponseSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;

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

export async function requestOtp(
  email: string,
  client: AxiosInstance = apiClient,
): Promise<RequestOtpResponse> {
  try {
    const res = await client.post<unknown>("/auth/otp/request", { email });
    return await parseOrThrow(RequestOtpResponseSchema, res.data);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

export async function verifyOtp(
  email: string,
  code: string,
  client: AxiosInstance = apiClient,
): Promise<VerifyOtpResponse> {
  try {
    // Field is `code` per backend schema (not `otp`).
    const res = await client.post<unknown>("/auth/otp/verify", { email, code });
    return await parseOrThrow(VerifyOtpResponseSchema, res.data);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}

export async function fetchMe(
  client: AxiosInstance = apiClient,
): Promise<Me> {
  try {
    const res = await client.get<unknown>("/me");
    return await parseOrThrow(MeResponseSchema, res.data);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw toTypedError(err);
  }
}
