import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { env } from "../lib/env";
import { clearToken, getToken } from "../auth/token-store";
import { logger } from "../lib/logger";

// Hook the auth state can register on boot to react to 401s without creating
// a circular import between client.ts and auth-state.ts.
type Unauthorize = () => void;
let onUnauthorized: Unauthorize | null = null;

export function setUnauthorizedHandler(fn: Unauthorize | null): void {
  onUnauthorized = fn;
}

export function createApiClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: env.API_URL,
    timeout: 30_000,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  instance.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      const token = await getToken();
      if (token) {
        // AxiosHeaders is class-based at runtime; .set is the safe API.
        config.headers.set("Authorization", `Bearer ${token}`);
      }
      return config;
    },
  );

  instance.interceptors.response.use(
    (res) => res,
    async (error: unknown) => {
      const ax = error as { response?: { status?: number } };
      if (ax?.response?.status === 401) {
        // Order matters: clear the token first, THEN signal unauthorized.
        // The auth state's reaction may try to re-bootstrap; we want a
        // guaranteed-empty store before that happens.
        try {
          await clearToken();
        } catch (clearErr) {
          logger.warn("Failed to clear token on 401", clearErr);
        }
        if (onUnauthorized) {
          try {
            onUnauthorized();
          } catch (handlerErr) {
            logger.warn("Unauthorized handler threw", handlerErr);
          }
        }
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

export const apiClient: AxiosInstance = createApiClient();
