// Mock token-store and the secure-store underneath. We control both so we
// can assert on the calls the interceptors make.
const mockGet = jest.fn<Promise<string | null>, []>();
const mockClear = jest.fn<Promise<void>, []>();

jest.mock("../auth/token-store", () => ({
  getToken: () => mockGet(),
  setToken: jest.fn(),
  clearToken: () => mockClear(),
}));

import { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { createApiClient, setUnauthorizedHandler } from "./client";

// Helper to grab the registered request and response interceptors. Axios
// stores them on .handlers; we exercise them directly so we don't need a
// running server.
type ReqHandler = {
  fulfilled: (
    config: InternalAxiosRequestConfig,
  ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
};
type ResHandler = {
  rejected: (err: unknown) => Promise<unknown>;
};

describe("api client interceptors", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);
    setUnauthorizedHandler(null);
  });

  it("attaches Authorization when a token exists", async () => {
    mockGet.mockResolvedValueOnce("jwt-abc");
    const client = createApiClient();
    const req = (
      client.interceptors.request as unknown as { handlers: ReqHandler[] }
    ).handlers[0];
    if (!req) throw new Error("expected request handler");

    const headers = new AxiosHeaders();
    const config = await req.fulfilled({
      headers,
      // The remaining axios config fields aren't read by our interceptor.
      url: "/auth/keys/register",
    } as unknown as InternalAxiosRequestConfig);
    expect(config.headers.get("Authorization")).toBe("Bearer jwt-abc");
  });

  it("does not attach Authorization when no token", async () => {
    mockGet.mockResolvedValueOnce(null);
    const client = createApiClient();
    const req = (
      client.interceptors.request as unknown as { handlers: ReqHandler[] }
    ).handlers[0];
    if (!req) throw new Error("expected request handler");

    const headers = new AxiosHeaders();
    const config = await req.fulfilled({
      headers,
    } as unknown as InternalAxiosRequestConfig);
    expect(config.headers.get("Authorization")).toBeFalsy();
  });

  it("signals on a 401 and leaves token-store clearing to auth-state handling", async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);

    const client = createApiClient();
    const res = (
      client.interceptors.response as unknown as { handlers: ResHandler[] }
    ).handlers[0];
    if (!res) throw new Error("expected response handler");

    await expect(
      res.rejected({ response: { status: 401 } }),
    ).rejects.toBeDefined();
    expect(onUnauth).toHaveBeenCalledTimes(1);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("does not signal global unauthorized handler for rotation-signature 401", async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);

    const client = createApiClient();
    const res = (
      client.interceptors.response as unknown as { handlers: ResHandler[] }
    ).handlers[0];
    if (!res) throw new Error("expected response handler");

    await expect(
      res.rejected({
        response: {
          status: 401,
          data: {
            message: "rotation_signature_invalid",
            error: "Unauthorized",
          },
        },
      }),
    ).rejects.toBeDefined();
    expect(onUnauth).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("does not signal for non-401 errors", async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);

    const client = createApiClient();
    const res = (
      client.interceptors.response as unknown as { handlers: ResHandler[] }
    ).handlers[0];
    if (!res) throw new Error("expected response handler");

    await expect(
      res.rejected({ response: { status: 500 } }),
    ).rejects.toBeDefined();
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it("does not signal on a network error (no response)", async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);

    const client = createApiClient();
    const res = (
      client.interceptors.response as unknown as { handlers: ResHandler[] }
    ).handlers[0];
    if (!res) throw new Error("expected response handler");

    await expect(
      res.rejected({ message: "Network Error", isAxiosError: true }),
    ).rejects.toBeDefined();
    expect(onUnauth).not.toHaveBeenCalled();
  });
});
