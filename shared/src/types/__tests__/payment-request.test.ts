import { describe, it, expect } from "vitest";
import { PaymentRequestSchema } from "../payment-request";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "../limits";

// Canonical valid fixture used across tests.
const validRequest = {
  version: 1 as const,
  merchantId: "u_abcdef0123456789",
  amountKobo: 50_000, // ₦500
  requestNonce: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  merchantLabel: "Campus Cafeteria",
  createdAt: new Date().toISOString(),
};

describe("PaymentRequestSchema", () => {
  it("parses a fully valid payment request", () => {
    const result = PaymentRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountKobo).toBe(50_000);
      expect(result.data.merchantId).toBe("u_abcdef0123456789");
    }
  });

  it("parses a valid request without optional merchantLabel", () => {
    const { merchantLabel: _omit, ...withoutLabel } = validRequest;
    const result = PaymentRequestSchema.safeParse(withoutLabel);
    expect(result.success).toBe(true);
  });

  it("rejects when amountKobo exceeds MAX_OFFLINE_TRANSACTION_KOBO", () => {
    const over = { ...validRequest, amountKobo: MAX_OFFLINE_TRANSACTION_KOBO + 1 };
    const result = PaymentRequestSchema.safeParse(over);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/exceeds maximum/);
    }
  });

  it("rejects when amountKobo is exactly MAX_OFFLINE_TRANSACTION_KOBO (boundary valid)", () => {
    const atCap = { ...validRequest, amountKobo: MAX_OFFLINE_TRANSACTION_KOBO };
    const result = PaymentRequestSchema.safeParse(atCap);
    // At the cap is allowed — max() is inclusive
    expect(result.success).toBe(true);
  });

  it("rejects a bad requestNonce (not 32 hex chars)", () => {
    const badNonce = { ...validRequest, requestNonce: "tooshort" };
    const result = PaymentRequestSchema.safeParse(badNonce);
    expect(result.success).toBe(false);
  });

  it("rejects a requestNonce with uppercase hex (must be lowercase)", () => {
    const upperNonce = {
      ...validRequest,
      requestNonce: "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4",
    };
    const result = PaymentRequestSchema.safeParse(upperNonce);
    expect(result.success).toBe(false);
  });

  it("rejects a malformed merchantId", () => {
    const bad = { ...validRequest, merchantId: "not-a-valid-id" };
    const result = PaymentRequestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects when required field merchantId is missing", () => {
    const { merchantId: _omit, ...missing } = validRequest;
    const result = PaymentRequestSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });

  it("rejects when createdAt is not a valid date string", () => {
    const bad = { ...validRequest, createdAt: "not-a-date" };
    const result = PaymentRequestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects extra unknown fields (strict mode)", () => {
    const extra = { ...validRequest, unknownField: "surprise" };
    const result = PaymentRequestSchema.safeParse(extra);
    expect(result.success).toBe(false);
  });
});
