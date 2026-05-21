import type {
  AdminMerchant,
  AdminOverview,
  CreateAdminMerchantInput,
  PendingCashout,
  PendingMerchant,
  ReconciliationReport,
  UpdateAdminMerchantInput,
} from "./types";

const configuredApiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");

type OnAuthFailure = () => void;

type RequestOptions = RequestInit & {
  requiresCsrf?: boolean;
};

type AdminSessionResponse = {
  authenticated: true;
  admin: {
    id: string;
    email: string;
    role: string;
  };
};

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  onAuthFailure?: OnAuthFailure,
): Promise<T> {
  const headers = new Headers(options.headers ?? undefined);
  if (options.requiresCsrf) {
    headers.set("X-Oneto-Admin-CSRF", "1");
  }
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
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

export function requestAdminOtp(email: string) {
  return request<{ ok: boolean }>("/auth/admin/otp/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyAdminOtp(email: string, code: string) {
  return request<{ success: true }>("/auth/admin/otp/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function logoutAdmin() {
  return request<{ success: true }>("/auth/admin/logout", {
    method: "POST",
  });
}

export function getAdminSession(onAuthFailure?: OnAuthFailure) {
  return request<AdminSessionResponse>("/auth/admin/session", {
    method: "GET",
  }, onAuthFailure);
}

export function getOverview(onAuthFailure: OnAuthFailure) {
  return request<AdminOverview>("/admin/overview", {
    method: "GET",
  }, onAuthFailure);
}

export function getReconciliationReport(onAuthFailure: OnAuthFailure) {
  return request<ReconciliationReport>("/admin/reconciliation-report", {
    method: "GET",
  }, onAuthFailure);
}

export async function getPendingMerchants(onAuthFailure: OnAuthFailure) {
  const result = await request<{ merchants: PendingMerchant[] }>(
    "/admin/merchants/pending",
    {
      method: "GET",
    },
    onAuthFailure,
  );

  return result.merchants;
}

export function approveMerchant(userId: string, onAuthFailure: OnAuthFailure) {
  return request<{ userId: string; status: string; verifiedAt: string }>(
    `/admin/merchants/${userId}/approve`,
    {
      method: "POST",
      requiresCsrf: true,
    },
    onAuthFailure,
  );
}

export async function getPendingCashouts(onAuthFailure: OnAuthFailure) {
  const result = await request<{ cashouts: PendingCashout[] }>(
    "/admin/cashouts/pending",
    {
      method: "GET",
    },
    onAuthFailure,
  );

  return result.cashouts;
}

export function approveCashout(id: string, onAuthFailure: OnAuthFailure) {
  return request<{ success: boolean }>(`/admin/cashouts/${id}/approve`, {
    method: "POST",
    requiresCsrf: true,
  }, onAuthFailure);
}

export async function getMerchants(onAuthFailure: OnAuthFailure) {
  const result = await request<{ merchants: AdminMerchant[] }>(
    "/admin/merchants",
    {
      method: "GET",
    },
    onAuthFailure,
  );

  return result.merchants;
}

export function createMerchant(
  input: CreateAdminMerchantInput,
  onAuthFailure: OnAuthFailure,
) {
  return request<{ merchant: AdminMerchant }>(
    "/admin/merchants",
    {
      method: "POST",
      body: JSON.stringify(input),
      requiresCsrf: true,
    },
    onAuthFailure,
  );
}

export function updateMerchant(
  userId: string,
  input: UpdateAdminMerchantInput,
  onAuthFailure: OnAuthFailure,
) {
  return request<{ merchant: AdminMerchant }>(
    `/admin/merchants/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
      requiresCsrf: true,
    },
    onAuthFailure,
  );
}

export function deactivateMerchant(userId: string, onAuthFailure: OnAuthFailure) {
  return request<{ userId: string; status: string }>(
    `/admin/merchants/${userId}/deactivate`,
    {
      method: "POST",
      requiresCsrf: true,
    },
    onAuthFailure,
  );
}

export function reactivateMerchant(userId: string, onAuthFailure: OnAuthFailure) {
  return request<{ userId: string; status: string; verifiedAt: string }>(
    `/admin/merchants/${userId}/reactivate`,
    {
      method: "POST",
      requiresCsrf: true,
    },
    onAuthFailure,
  );
}
