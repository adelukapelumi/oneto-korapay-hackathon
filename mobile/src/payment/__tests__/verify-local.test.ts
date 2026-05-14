import { verifyEnvelopeLocally } from "../verify-local";
import { TransactionEnvelopeSchema } from "@oneto/shared/src/types/envelope";

// We mock verifyEnvelope at the module boundary
jest.mock("@oneto/shared", () => {
  const types = jest.requireActual("@oneto/shared/src/types/envelope") as any;
  return {
    ...types,
    verifyEnvelope: jest.fn(),
  };
});

// Need to require it after the mock to get the mocked version
const { verifyEnvelope } = require("@oneto/shared");

describe("verifyEnvelopeLocally", () => {
  const nowMs = 1700000000000;
  const validEnvelope = {
    version: 1,
    transactionId: "tx_1234567890abcdef",
    senderUserId: "u_1234567890abcdef",
    senderPublicKey: "ed25519:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    recipientUserId: "u_abcdef1234567890",
    amountKobo: 10000,
    senderSequenceNumber: 1,
    senderBalanceBeforeKobo: 50000,
    senderBalanceAfterKobo: 40000,
    timestamp: "2023-11-14T21:20:00.000Z",
    expiresAt: "2023-11-14T21:21:00.000Z",
    requestNonce: "0123456789abcdef0123456789abcdef",
    signature: "ed25519:" + "a".repeat(128),
  };

  beforeEach(() => {
    (verifyEnvelope as jest.Mock).mockClear();
  });

  it("returns ok: true when verifyEnvelope succeeds", () => {
    (verifyEnvelope as jest.Mock).mockReturnValue({ ok: true });
    
    const result = verifyEnvelopeLocally(validEnvelope, nowMs);
    
    expect(result).toEqual({ ok: true, envelope: validEnvelope });
    expect(verifyEnvelope).toHaveBeenCalledWith(validEnvelope, validEnvelope.senderPublicKey, nowMs);
  });

  it("returns ok: false when verifyEnvelope fails", () => {
    (verifyEnvelope as jest.Mock).mockReturnValue({ ok: false, reason: "invalid signature" });
    
    const result = verifyEnvelopeLocally(validEnvelope, nowMs);
    
    expect(result).toEqual({ ok: false, reason: "invalid signature" });
    expect(verifyEnvelope).toHaveBeenCalledWith(validEnvelope, validEnvelope.senderPublicKey, nowMs);
  });

  it("rejects immediately on invalid schema without calling verifyEnvelope", () => {
    const invalidEnvelope = { ...validEnvelope, amountKobo: -100 }; // invalid amount
    
    const result = verifyEnvelopeLocally(invalidEnvelope, nowMs);
    
    expect(result).toEqual({ ok: false, reason: "Invalid envelope format" });
    expect(verifyEnvelope).not.toHaveBeenCalled();
  });
  
  it("rejects immediately on completely malformed input", () => {
    const result = verifyEnvelopeLocally("not json", nowMs);
    
    expect(result).toEqual({ ok: false, reason: "Invalid envelope format" });
    expect(verifyEnvelope).not.toHaveBeenCalled();
  });
});
