import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { env } from "../lib/env";
import { getToken } from "../auth/token-store";
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
      if (typeof config.url === "string" && config.url === "/auth/keys/register") {
        const hasAuthorization = Boolean(config.headers.get("Authorization"));
        logger.info("auth_header_presence_for_key_register", {
          tokenPresent: Boolean(token),
          hasAuthorization,
        });
      }
      return config;
    },
  );

  instance.interceptors.response.use(
    (res) => res,
    async (error: unknown) => {
      const ax = error as {
        config?: { url?: string };
        response?: {
          status?: number;
          data?: { message?: unknown; error?: unknown };
        };
      };
      if (ax?.response?.status === 401) {
        const responseData = ax.response.data;
        const responseMessage =
          responseData && typeof responseData.message === "string"
            ? responseData.message
            : null;
        logger.info("api_unauthorized_response", {
          status: 401,
          endpoint: ax.config?.url ?? null,
          errorCode:
            responseData && typeof responseData.error === "string"
              ? responseData.error
              : null,
          responseMessage,
        });
        if (onUnauthorized && responseMessage !== "rotation_signature_invalid") {
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
