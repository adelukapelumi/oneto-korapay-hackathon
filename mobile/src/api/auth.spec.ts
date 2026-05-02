import type { AxiosInstance } from "axios";
import { fetchMe, requestOtp, verifyOtp } from "./auth";
import { ApiError, NetworkError, UnauthorizedError } from "./errors";

function fakeClient(opts: {
  post?: (url: string, body: unknown) => Promise<{ data: unknown }>;
  get?: (url: string) => Promise<{ data: unknown }>;
}): AxiosInstance {
  return {
    post: opts.post ?? (() => Promise.reject(new Error("post not configured"))),
    get: opts.get ?? (() => Promise.reject(new Error("get not configured"))),
  } as unknown as AxiosInstance;
}

describe("requestOtp", () => {
  it("posts to /auth/otp/request with email and returns parsed response", async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ data: { success: true, message: "sent" } });
    const result = await requestOtp(
      "user@example.com",
      fakeClient({ post: (url, body) => post(url, body) }),
    );
    expect(post).toHaveBeenCalledWith("/auth/otp/request", {
      email: "user@example.com",
    });
    expect(result).toEqual({ success: true, message: "sent" });
  });

  it("throws ApiError on schema mismatch", async () => {
    const client = fakeClient({
      post: () => Promise.resolve({ data: { success: false } }),
    });
    await expect(requestOtp("user@example.com", client)).rejects.toThrow(
      ApiError,
    );
  });

  it("converts network errors to NetworkError", async () => {
    const client = fakeClient({
      post: () =>
        Promise.reject({ isAxiosError: true, response: undefined }),
    });
    await expect(requestOtp("user@example.com", client)).rejects.toThrow(
      NetworkError,
    );
  });
});

describe("verifyOtp", () => {
  it("posts to /auth/otp/verify using the field name `code`", async () => {
    const post = jest.fn().mockResolvedValue({
      data: { success: true, accessToken: "jwt-abcdefg-long-enough" },
    });
    const result = await verifyOtp(
      "user@example.com",
      "123456",
      fakeClient({ post: (url, body) => post(url, body) }),
    );
    expect(post).toHaveBeenCalledWith("/auth/otp/verify", {
      email: "user@example.com",
      code: "123456",
    });
    expect(result.accessToken).toBe("jwt-abcdefg-long-enough");
  });

  it("converts a 401 to UnauthorizedError", async () => {
    const client = fakeClient({
      post: () =>
        Promise.reject({
          isAxiosError: true,
          response: { status: 401, data: { message: "Invalid or expired code" } },
        }),
    });
    await expect(
      verifyOtp("user@example.com", "000000", client),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects responses missing accessToken", async () => {
    const client = fakeClient({
      post: () => Promise.resolve({ data: { success: true } }),
    });
    await expect(
      verifyOtp("user@example.com", "123456", client),
    ).rejects.toThrow(ApiError);
  });
});

describe("fetchMe", () => {
  const validMe = {
    id: "u_1234567890abcdef",
    email: "user@example.com",
    phone: null,
    role: "USER",
    status: "ACTIVE",
    verifiedBalanceKobo: "0",
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  it("parses a well-formed /me response", async () => {
    const client = fakeClient({
      get: () => Promise.resolve({ data: validMe }),
    });
    const me = await fetchMe(client);
    expect(me.email).toBe("user@example.com");
    expect(me.role).toBe("USER");
  });

  it("rejects unknown role values", async () => {
    const client = fakeClient({
      get: () =>
        Promise.resolve({ data: { ...validMe, role: "GHOST" } }),
    });
    await expect(fetchMe(client)).rejects.toThrow(ApiError);
  });

  it("rejects unknown status values", async () => {
    const client = fakeClient({
      get: () =>
        Promise.resolve({ data: { ...validMe, status: "WEIRD" } }),
    });
    await expect(fetchMe(client)).rejects.toThrow(ApiError);
  });

  it("accepts a non-null phone", async () => {
    const client = fakeClient({
      get: () =>
        Promise.resolve({ data: { ...validMe, phone: "+2348000000000" } }),
    });
    const me = await fetchMe(client);
    expect(me.phone).toBe("+2348000000000");
  });
});
