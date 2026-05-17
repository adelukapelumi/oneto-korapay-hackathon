import type {
  AdminOverview,
  PendingCashout,
  PendingMerchant,
  ReconciliationReport,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

type OnAuthFailure = () => void;

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  onAuthFailure?: OnAuthFailure,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    onAuthFailure?.();
    throw new Error("Your session has expired. Please log in again.");
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    const messageFromBody =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed with status ${response.status}`;

    throw new Error(messageFromBody);
  }

  return payload as T;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function requestAdminOtp(email: string) {
  return request<{ ok: boolean }>("/auth/admin/otp/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyAdminOtp(email: string, code: string): Promise<string> {
  const result = await request<{ success: boolean; accessToken: string }>("/auth/admin/otp/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });

  return result.accessToken;
}

export function getOverview(token: string, onAuthFailure: OnAuthFailure) {
  return request<AdminOverview>("/admin/overview", {
    method: "GET",
    headers: authHeaders(token),
  }, onAuthFailure);
}

export function getReconciliationReport(token: string, onAuthFailure: OnAuthFailure) {
  return request<ReconciliationReport>("/admin/reconciliation-report", {
    method: "GET",
    headers: authHeaders(token),
  }, onAuthFailure);
}

export async function getPendingMerchants(token: string, onAuthFailure: OnAuthFailure) {
  const result = await request<{ merchants: PendingMerchant[] }>("/admin/merchants/pending", {
    method: "GET",
    headers: authHeaders(token),
  }, onAuthFailure);

  return result.merchants;
}

export function approveMerchant(userId: string, token: string, onAuthFailure: OnAuthFailure) {
  return request<{ userId: string; status: string; verifiedAt: string }>(`/admin/merchants/${userId}/approve`, {
    method: "POST",
    headers: authHeaders(token),
  }, onAuthFailure);
}

export async function getPendingCashouts(token: string, onAuthFailure: OnAuthFailure) {
  const result = await request<{ cashouts: PendingCashout[] }>("/admin/cashouts/pending", {
    method: "GET",
    headers: authHeaders(token),
  }, onAuthFailure);

  return result.cashouts;
}

export function approveCashout(id: string, token: string, onAuthFailure: OnAuthFailure) {
  return request<{ success: boolean }>(`/admin/cashouts/${id}/approve`, {
    method: "POST",
    headers: authHeaders(token),
  }, onAuthFailure);
}
