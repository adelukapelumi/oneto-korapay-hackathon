import { envSchema } from "./env.schema";

const makeBaseEnv = (overrides: Record<string, string | undefined> = {}) => ({
  PORT: "3000",
  DATABASE_URL: "https://example.com/db",
  JWT_SECRET: "12345678901234567890123456789012",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_ADDRESS: "noreply@getoneto.com",
  KORAPAY_PUBLIC_KEY: "pk_test_key",
  KORAPAY_SECRET_KEY: "sk_test_key",
  ...overrides,
});

describe("envSchema", () => {
  it("fails in production without Redis storage selection", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "memory",
        THROTTLER_STORE_BACKEND: "memory",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["OTP_STORE_BACKEND"] }),
          expect.objectContaining({ path: ["THROTTLER_STORE_BACKEND"] }),
        ]),
      );
    }
  });

  it("fails in production without REDIS_URL when Redis storage is required", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "redis",
        THROTTLER_STORE_BACKEND: "redis",
        REDIS_URL: undefined,
        REDIS_KEY_PREFIX: "oneto:prod",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["REDIS_URL"] }),
        ]),
      );
    }
  });

  it("fails in production when REDIS_KEY_PREFIX is omitted", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "redis",
        THROTTLER_STORE_BACKEND: "redis",
        REDIS_URL: "redis://127.0.0.1:6379",
        REDIS_KEY_PREFIX: undefined,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["REDIS_KEY_PREFIX"] }),
        ]),
      );
    }
  });

  it('fails in production when REDIS_KEY_PREFIX is "oneto:dev"', () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "redis",
        THROTTLER_STORE_BACKEND: "redis",
        REDIS_URL: "redis://127.0.0.1:6379",
        REDIS_KEY_PREFIX: "oneto:dev",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["REDIS_KEY_PREFIX"] }),
        ]),
      );
    }
  });

  it("allows development memory fallback", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "development",
        OTP_STORE_BACKEND: "memory",
        THROTTLER_STORE_BACKEND: "memory",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OTP_STORE_BACKEND).toBe("memory");
      expect(result.data.THROTTLER_STORE_BACKEND).toBe("memory");
      expect(result.data.JWT_ACCESS_TTL_SECONDS).toBe(3600);
      expect(result.data.REDIS_KEY_PREFIX).toBe("oneto:dev");
      expect(result.data.CASHOUT_PAYOUT_MODE).toBe("korapay_api");
    }
  });

  it("fails in production without ADMIN_WEB_ORIGINS", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "redis",
        THROTTLER_STORE_BACKEND: "redis",
        REDIS_URL: "redis://127.0.0.1:6379",
        REDIS_KEY_PREFIX: "oneto:prod",
        ADMIN_WEB_ORIGINS: undefined,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["ADMIN_WEB_ORIGINS"] }),
        ]),
      );
    }
  });

  it("allows test memory fallback", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "test",
        OTP_STORE_BACKEND: "memory",
        THROTTLER_STORE_BACKEND: "memory",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REDIS_KEY_PREFIX).toBe("oneto:dev");
    }
  });

  it("accepts Redis-backed production config with explicit prefix", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "production",
        OTP_STORE_BACKEND: "redis",
        THROTTLER_STORE_BACKEND: "redis",
        REDIS_URL: "redis://127.0.0.1:6379",
        REDIS_KEY_PREFIX: "oneto:prod",
        ADMIN_WEB_ORIGINS: "https://admin.getoneto.com",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.REDIS_KEY_PREFIX).toBe("oneto:prod");
    }
  });

  it("accepts ADMIN_OUTBOUND_IP_DIAGNOSTIC_ENABLED when set to false", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        NODE_ENV: "development",
        ADMIN_OUTBOUND_IP_DIAGNOSTIC_ENABLED: "false",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ADMIN_OUTBOUND_IP_DIAGNOSTIC_ENABLED).toBe("false");
    }
  });

  it("accepts manual cashout payout mode", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        CASHOUT_PAYOUT_MODE: "manual",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CASHOUT_PAYOUT_MODE).toBe("manual");
    }
  });

  it("rejects invalid admin cashout notification email list", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        ADMIN_CASHOUT_NOTIFICATION_EMAILS: "admin@getoneto.com,not-an-email",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["ADMIN_CASHOUT_NOTIFICATION_EMAILS"],
          }),
        ]),
      );
    }
  });

  it("rejects JWT_ACCESS_TTL_SECONDS above 24 hours", () => {
    const result = envSchema.safeParse(
      makeBaseEnv({
        JWT_ACCESS_TTL_SECONDS: "90000",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["JWT_ACCESS_TTL_SECONDS"] }),
        ]),
      );
    }
  });
});
