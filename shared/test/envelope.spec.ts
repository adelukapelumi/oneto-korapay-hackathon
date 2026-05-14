import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeypair,
  signEnvelope,
  verifyEnvelope,
  EnvelopeDraft,
  EnvelopeDraftSchema,
  TransactionEnvelope,
  TransactionEnvelopeSchema,
  MAX_OFFLINE_TRANSACTION_KOBO,
  PublicKeyString,
  toPublicKeyString,
} from "../src";

// ---------- test fixtures ----------

function makeDraft(overrides: Partial<EnvelopeDraft> = {}): EnvelopeDraft {
  const now = Date.now();
  const ts = new Date(now).toISOString();
  const exp = new Date(now + 60_000).toISOString();
  return {
    version: 1,
    senderUserId: "u_0123456789abcdef",
    senderPublicKey: "ed25519:" + "a".repeat(64),
    recipientUserId: "u_fedcba9876543210",
    amountKobo: 50_000,
    senderSequenceNumber: 1,
    senderBalanceBeforeKobo: 200_000,
    senderBalanceAfterKobo: 150_000,
    timestamp: ts,
    expiresAt: exp,
    requestNonce: "0".repeat(32),
    ...overrides,
  } as EnvelopeDraft;
}

describe("envelope: happy path", () => {
  let kp: ReturnType<typeof generateKeypair>;

  beforeAll(() => {
    kp = generateKeypair();
  });

  it("signs and verifies a valid envelope", () => {
    const draft = makeDraft({ senderPublicKey: kp.publicKeyString });
    const envelope = signEnvelope(draft, kp.privateKey);

    expect(envelope.signature).toMatch(/^ed25519:[0-9a-f]{128}$/);
    expect(envelope.transactionId).toMatch(/^tx_[0-9a-f]{16}$/);

    const result = verifyEnvelope(envelope, kp.publicKeyString);
    expect(result.ok).toBe(true);
  });

  it("produces deterministic transactionId for same draft", () => {
    const draft = makeDraft({ senderPublicKey: kp.publicKeyString });
    const env1 = signEnvelope(draft, kp.privateKey);
    const env2 = signEnvelope(draft, kp.privateKey);
    expect(env1.transactionId).toBe(env2.transactionId);
    // Note: signatures themselves are deterministic with Ed25519.
    expect(env1.signature).toBe(env2.signature);
  });
});

describe("envelope: ttl schema bounds", () => {
  let kp: ReturnType<typeof generateKeypair>;

  beforeAll(() => {
    kp = generateKeypair();
  });

  it("draft with expiresAt exactly timestamp + 60s passes", () => {
    const now = Date.now();
    const draft = makeDraft({
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const result = EnvelopeDraftSchema.safeParse(draft);
    expect(result.success).toBe(true);
  });

  it("full TransactionEnvelope with expiresAt exactly timestamp + 60s passes", () => {
    const now = Date.now();
    const draft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const envelope = signEnvelope(draft, kp.privateKey);
    const result = TransactionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it("draft with expiresAt timestamp + 60_001ms fails", () => {
    const now = Date.now();
    const draft = makeDraft({
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_001).toISOString(),
    });
    const result = EnvelopeDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
  });

  it("full TransactionEnvelope with expiresAt timestamp + 60_001ms fails", () => {
    const now = Date.now();
    const draft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const envelope = signEnvelope(draft, kp.privateKey);
    const mutatedTtlEnvelope: TransactionEnvelope = {
      ...envelope,
      expiresAt: new Date(now + 60_001).toISOString(),
    };
    const result = TransactionEnvelopeSchema.safeParse(mutatedTtlEnvelope);
    expect(result.success).toBe(false);
  });

  it("expiresAt equal to timestamp fails for draft and full envelope", () => {
    const now = Date.now();
    const ts = new Date(now).toISOString();
    const draft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: ts,
      expiresAt: ts,
    });
    const draftResult = EnvelopeDraftSchema.safeParse(draft);
    expect(draftResult.success).toBe(false);

    const baseDraft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: ts,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const envelope = signEnvelope(baseDraft, kp.privateKey);
    const equalExpiryEnvelope: TransactionEnvelope = {
      ...envelope,
      expiresAt: ts,
    };
    const envelopeResult = TransactionEnvelopeSchema.safeParse(equalExpiryEnvelope);
    expect(envelopeResult.success).toBe(false);
  });

  it("expiresAt before timestamp fails for draft and full envelope", () => {
    const now = Date.now();
    const draft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now - 1).toISOString(),
    });
    const draftResult = EnvelopeDraftSchema.safeParse(draft);
    expect(draftResult.success).toBe(false);

    const baseDraft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    const envelope = signEnvelope(baseDraft, kp.privateKey);
    const beforeExpiryEnvelope: TransactionEnvelope = {
      ...envelope,
      expiresAt: new Date(now - 1).toISOString(),
    };
    const envelopeResult = TransactionEnvelopeSchema.safeParse(beforeExpiryEnvelope);
    expect(envelopeResult.success).toBe(false);
  });
});

// ---------- red-team: attacks that MUST fail verification ----------

describe("envelope: red-team attacks", () => {
  let kp: ReturnType<typeof generateKeypair>;
  let validEnvelope: TransactionEnvelope;

  beforeAll(() => {
    kp = generateKeypair();
    const draft = makeDraft({ senderPublicKey: kp.publicKeyString });
    validEnvelope = signEnvelope(draft, kp.privateKey);
  });

  it("rejects tampered amount", () => {
    const tampered = { ...validEnvelope, amountKobo: 1 };
    const result = verifyEnvelope(tampered, kp.publicKeyString);
    expect(result.ok).toBe(false);
    // Schema rejects first because balance math no longer holds.
    if (!result.ok) {
      expect(["schema_invalid", "signature_invalid"]).toContain(result.reason);
    }
  });

  it("rejects tampered recipient", () => {
    const tampered = {
      ...validEnvelope,
      recipientUserId: "u_0000000000000000",
    };
    const result = verifyEnvelope(tampered, kp.publicKeyString);
    expect(result.ok).toBe(false);
  });

  it("rejects replay with different registered public key", () => {
    const otherKp = generateKeypair();
    const result = verifyEnvelope(validEnvelope, otherKp.publicKeyString);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("public_key_mismatch");
    }
  });

  it("rejects expired envelope", () => {
    const draft = makeDraft({ senderPublicKey: kp.publicKeyString });
    const envelope = signEnvelope(draft, kp.privateKey);
    // Fast-forward 2 minutes past expiry
    const future = Date.now() + 2 * 60_000;
    const result = verifyEnvelope(envelope, kp.publicKeyString, future);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timestamp_out_of_window");
    }
  });

  it("rejects envelope with timestamp far in the future", () => {
    const now = Date.now();
    const farFuture = now + 30 * 60_000; // 30 min ahead
    const draft = makeDraft({
      senderPublicKey: kp.publicKeyString,
      timestamp: new Date(farFuture).toISOString(),
      expiresAt: new Date(farFuture + 60_000).toISOString(),
    });
    const envelope = signEnvelope(draft, kp.privateKey);
    const result = verifyEnvelope(envelope, kp.publicKeyString, now);
    expect(result.ok).toBe(false);
  });

  it("rejects zero amount", () => {
    // Schema rejects at draft level
    expect(() =>
      signEnvelope(
        makeDraft({
          senderPublicKey: kp.publicKeyString,
          amountKobo: 0,
          senderBalanceAfterKobo: 200_000,
        }),
        kp.privateKey,
      ),
    ).toThrow();
  });

  it("rejects negative amount", () => {
    expect(() =>
      signEnvelope(
        makeDraft({
          senderPublicKey: kp.publicKeyString,
          amountKobo: -100,
        }),
        kp.privateKey,
      ),
    ).toThrow();
  });

  it("rejects amount above max offline limit", () => {
    expect(() =>
      signEnvelope(
        makeDraft({
          senderPublicKey: kp.publicKeyString,
          amountKobo: MAX_OFFLINE_TRANSACTION_KOBO + 1,
          senderBalanceBeforeKobo: MAX_OFFLINE_TRANSACTION_KOBO + 1,
          senderBalanceAfterKobo: 0,
        }),
        kp.privateKey,
      ),
    ).toThrow();
  });

  it("rejects inconsistent balance math", () => {
    expect(() =>
      signEnvelope(
        makeDraft({
          senderPublicKey: kp.publicKeyString,
          amountKobo: 50_000,
          senderBalanceBeforeKobo: 200_000,
          senderBalanceAfterKobo: 100_000, // should be 150_000
        }),
        kp.privateKey,
      ),
    ).toThrow();
  });

  it("rejects self-payment (sender === recipient)", () => {
    expect(() =>
      signEnvelope(
        makeDraft({
          senderPublicKey: kp.publicKeyString,
          senderUserId: "u_0123456789abcdef",
          recipientUserId: "u_0123456789abcdef",
        }),
        kp.privateKey,
      ),
    ).toThrow();
  });

  it("rejects mutation of transactionId", () => {
    const tampered = {
      ...validEnvelope,
      transactionId: "tx_0000000000000000" as TransactionEnvelope["transactionId"],
    };
    const result = verifyEnvelope(tampered, kp.publicKeyString);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["transaction_id_mismatch", "signature_invalid"]).toContain(
        result.reason,
      );
    }
  });

  it("rejects mutation of signature", () => {
    const tampered = {
      ...validEnvelope,
      // flip the last byte
      signature:
        validEnvelope.signature.slice(0, -2) +
        (validEnvelope.signature.slice(-2) === "00" ? "01" : "00"),
    };
    const result = verifyEnvelope(tampered, kp.publicKeyString);
    expect(result.ok).toBe(false);
  });

  it("rejects completely malformed input", () => {
    expect(verifyEnvelope({}, "ed25519:" + "a".repeat(64) as PublicKeyString).ok).toBe(false);
    expect(verifyEnvelope(null, "ed25519:" + "a".repeat(64) as PublicKeyString).ok).toBe(false);
    expect(verifyEnvelope("hello", "ed25519:" + "a".repeat(64) as PublicKeyString).ok).toBe(false);
  });
});

// ---------- canonicalization determinism ----------

describe("canonicalization", () => {
  it("produces identical bytes regardless of key insertion order", async () => {
    const { canonicalize } = await import("../src/crypto/canonicalize");
    const a = { b: 2, a: 1, c: { y: 2, x: 1 } };
    const b = { c: { x: 1, y: 2 }, a: 1, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});
