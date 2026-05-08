import { createPaymentRequest } from "../create-request";
import { PaymentRequestSchema } from "@oneto/shared/src/types/payment-request";

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(
    new Uint8Array(16).map((_, i) => i) // returns [0, 1, 2, ..., 15]
  ),
}));

describe("createPaymentRequest", () => {
  it("generates a request that satisfies the PaymentRequestSchema", async () => {
    const req = await createPaymentRequest("u_1234567890abcdef", 150000, "Campus Cafe");
    const parsed = PaymentRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
  });

  it("generates a 32-character hex nonce", async () => {
    const req = await createPaymentRequest("u_1234567890abcdef", 100);
    expect(req.requestNonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("passes amountKobo and merchant parameters correctly", async () => {
    const req = await createPaymentRequest("u_abcdef1234567890", 250000, "Bookstore");
    expect(req.merchantId).toBe("u_abcdef1234567890");
    expect(req.amountKobo).toBe(250000);
    expect(req.merchantLabel).toBe("Bookstore");
    expect(req.version).toBe(1);
  });
});
