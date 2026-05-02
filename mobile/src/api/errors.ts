import type { AxiosError } from "axios";

// Distinguishing "no internet" from "server said no" lets the UI render
// helpful messages instead of generic "something went wrong".
//
// Expectations from the backend:
//   - 200 responses: success
//   - 4xx: client error, parse `message` if present
//   - 5xx: server error
//   - axios ECONNABORTED / no response: NetworkError
//
// We never return raw axios errors to UI code — they leak internals.

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message = "Couldn't reach oneto. Check your connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

interface BackendErrorBody {
  readonly message?: string;
  readonly statusCode?: number;
  readonly error?: string;
}

function isBackendErrorBody(value: unknown): value is BackendErrorBody {
  return typeof value === "object" && value !== null;
}

export function toTypedError(err: unknown): ApiError | NetworkError {
  if (err instanceof ApiError || err instanceof NetworkError) {
    return err;
  }

  // Duck-type instead of instanceof axios.AxiosError. The bundled axios in
  // some test environments has a separate AxiosError class identity than the
  // one used at runtime, so instanceof is unreliable.
  const ax = err as Partial<AxiosError>;
  if (ax && typeof ax === "object" && "isAxiosError" in ax) {
    if (!ax.response) {
      return new NetworkError();
    }
    const status = ax.response.status;
    const body: unknown = ax.response.data;
    let message = `Request failed with status ${status}`;
    if (isBackendErrorBody(body) && typeof body.message === "string") {
      message = body.message;
    }
    if (status === 401) {
      return new UnauthorizedError(message);
    }
    return new ApiError(message, status);
  }

  if (err instanceof Error) {
    return new ApiError(err.message, 0);
  }
  return new ApiError("Unknown error", 0);
}
