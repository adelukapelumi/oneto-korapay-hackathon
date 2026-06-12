// Tests for mobile/src/payment/build-envelope.ts
//
// We mock signEnvelope at the module boundary to test the wiring logic
// (balance check, sequence increment, draft shape) without pulling in the
// real ESM crypto libraries (@noble/ed25519) which cause Jest configuration
// issues in the mobile CommonJS test environment.
//
// Three attack vectors this module defends against:
//
//   Attack 1 — Tampered merchant QR with inflated amount
//     Defense: amountKobo is checked against spendable balance before signing.
//              InsufficientBalanceError is thrown if the amount exceeds balance.
//
//   Attack 2 — Student tries to sign without a synced balance (no verified balance)
//     Defense: getLocalState("verified_balance_kobo") === null → throws.
//
//   Attack 3 — Student tries to double-spend (submits same envelope twice)
//     Defense: sequence numbers are unique per sender (server enforces this).
//              Locally, getNextSequenceNumber increments each call.

// ---- Mocks ---------------------------------------------------------------

// 1. Mock @oneto/shared (replaces the real ESM imports)
jest.mock("@oneto/shared", () => {
  return {
    signEnvelope: jest.fn((draft, _privateKey) => {
      // Return a fake signed envelope based on the draft
      return {
        ...draft,
        transactionId: "tx_mocked123456789",
        signature: "ed25519:mockedsignature",
      };
    }),
    MAX_OFFLINE_TRANSACTION_KOBO: 200_000,
  };
});

// 2. Mock expo-sqlite (required by ../ledger/db)
interface MockRow {
  [k: string]: string | number | null;
}
type TableStore = Map<string, MockRow[]>;

function createMockDb() {
  const tables: TableStore = new Map();
  const state: Map<string, string> = new Map();
  let nextSeqOverride: number | null = null;
  let pendingOutgoingOverride: number | null = null;

  function execSync(_source: string): void {}
  function runSync(_source: string, ..._params: unknown[]): { changes: number } {
    return { changes: 1 };
  }
  function getFirstSync<T>(source: string, ...params: (string | number | null)[]): T | null {
    const s = source.toUpperCase();
    if (s.includes("COALESCE(SUM(AMOUNT_KOBO)")) {
      return { total: pendingOutgoingOverride ?? 0 } as unknown as T;
    }
    if (s.includes("COALESCE(MAX(SEQUENCE_NUMBER)")) {
      return { next: nextSeqOverride ?? 1 } as unknown as T;
    }
    if (s.includes("SELECT VALUE FROM LOCAL_STATE")) {
      const key = params[0] as string;
      const value = state.get(key);
      return value !== undefined ? ({ value } as unknown as T) : null;
    }
    return null;
  }
  function getAllSync<T>(_source: string, ..._params: unknown[]): T[] {
    return [];
  }

  return {
    execSync,
    runSync,
    getFirstSync,
    getAllSync,
    // Test helpers
    setState: (key: string, value: string) => state.set(key, value),
    clearState: (key: string) => state.delete(key),
    setNextSeq: (n: number) => { nextSeqOverride = n; },
    setPendingOutgoing: (n: number) => { pendingOutgoingOverride = n; },
    reset: () => {
      state.clear();
      nextSeqOverride = null;
      pendingOutgoingOverride = null;
      tables.clear();
    },
  };
}

const mockDb = createMockDb();

jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => mockDb),
}));

// ---- Imports (after mocks) -----------------------------------------------

import { buildAndSignEnvelope, InsufficientBalanceError } from "../build-envelope";
import { initDb } from "../../ledger/db";
import { signEnvelope } from "@oneto/shared";
import type { PaymentRequest, EnvelopeDraft } from "@oneto/shared";

// ---- Fixtures ---------------------------------------------------------------

const baseRequest: PaymentRequest = {
  version: 1,
  merchantId: "u_fedcba9876543210",
  amountKobo: 50_000, // ₦500
  requestNonce: "a".repeat(32),
  merchantLabel: "Campus Eatery",
  createdAt: new Date().toISOString(),
};

function makeInput(overrides?: Partial<{
  paymentRequest: PaymentRequest;
  senderUserId: string;
  senderPublicKey: string;
  privateKey: Uint8Array;
}>) {
  return {
    paymentRequest: baseRequest,
    senderUserId: "u_0123456789abcdef",
    senderPublicKey: "ed25519:mockedpublickey",
    privateKey: new Uint8Array(32), // Fake private key
    ...overrides,
  };
}

// ---- Setup / teardown -------------------------------------------------------

beforeEach(() => {
  mockDb.reset();
  initDb();
  (signEnvelope as jest.Mock).mockClear();
});

// ---- Tests ------------------------------------------------------------------

describe("buildAndSignEnvelope — happy path", () => {
  it("constructs correct draft and delegates to signEnvelope", () => {
    mockDb.setState("available_balance_kobo", "200000");
    mockDb.setPendingOutgoing(0);
    mockDb.setNextSeq(1);

    const input = makeInput();
    const envelope = buildAndSignEnvelope(input);

    expect(signEnvelope).toHaveBeenCalledTimes(1);
    
    // Check the draft that was passed to signEnvelope
    const draftPassed = (signEnvelope as jest.Mock).mock.calls[0][0] as EnvelopeDraft;
    
    expect(draftPassed.version).toBe(1);
    expect(draftPassed.amountKobo).toBe(50_000);
    expect(draftPassed.senderUserId).toBe("u_0123456789abcdef");
    expect(draftPassed.recipientUserId).toBe("u_fedcba9876543210");
    expect(draftPassed.senderSequenceNumber).toBe(1);
    // Balance math must hold
    expect(draftPassed.senderBalanceBeforeKobo).toBe(200_000);
    expect(draftPassed.senderBalanceAfterKobo).toBe(150_000);
    
    // Ensure the returned envelope includes the mocked fields
    expect(envelope.transactionId).toBe("tx_mocked123456789");
    expect(envelope.signature).toBe("ed25519:mockedsignature");
  });

  it("senderBalanceAfterKobo === senderBalanceBeforeKobo - amountKobo", () => {
    mockDb.setState("available_balance_kobo", "300000");
    mockDb.setPendingOutgoing(50_000); // 50_000 pending = 250_000 spendable
    mockDb.setNextSeq(2);

    buildAndSignEnvelope(makeInput({ paymentRequest: { ...baseRequest, amountKobo: 100_000 } }));

    const draftPassed = (signEnvelope as jest.Mock).mock.calls[0][0] as EnvelopeDraft;

    expect(draftPassed.senderBalanceBeforeKobo).toBe(250_000);
    expect(draftPassed.senderBalanceAfterKobo).toBe(150_000);
    expect(draftPassed.senderBalanceAfterKobo).toBe(
      draftPassed.senderBalanceBeforeKobo - draftPassed.amountKobo,
    );
  });

  it("uses the sequence number from getNextSequenceNumber", () => {
    mockDb.setState("available_balance_kobo", "500000");
    mockDb.setPendingOutgoing(0);
    mockDb.setNextSeq(7); // Simulate 6 previous transactions

    buildAndSignEnvelope(makeInput());

    const draftPassed = (signEnvelope as jest.Mock).mock.calls[0][0] as EnvelopeDraft;
    expect(draftPassed.senderSequenceNumber).toBe(7);
  });
});

describe("buildAndSignEnvelope — error cases", () => {
  it("throws when no verified balance is stored (offline, never synced)", () => {
    // State is empty — no verified_balance_kobo key set
    expect(() => buildAndSignEnvelope(makeInput())).toThrow(
      /No verified balance stored locally/,
    );
    expect(signEnvelope).not.toHaveBeenCalled();
  });

  it("throws InsufficientBalanceError when spendable < requested", () => {
    // Only 30_000 kobo available, request is 50_000
    mockDb.setState("available_balance_kobo", "80000");
    mockDb.setPendingOutgoing(50_000); // spendable = 30_000
    mockDb.setNextSeq(1);

    const request: PaymentRequest = { ...baseRequest, amountKobo: 50_000 };

    expect(() => buildAndSignEnvelope(makeInput({ paymentRequest: request }))).toThrow(
      InsufficientBalanceError,
    );
    expect(signEnvelope).not.toHaveBeenCalled();
  });

  it("InsufficientBalanceError carries correct available/requested fields", () => {
    mockDb.setState("available_balance_kobo", "100000");
    mockDb.setPendingOutgoing(90_000); // spendable = 10_000
    mockDb.setNextSeq(1);

    const request: PaymentRequest = { ...baseRequest, amountKobo: 50_000 };

    try {
      buildAndSignEnvelope(makeInput({ paymentRequest: request }));
      fail("Expected InsufficientBalanceError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const e = err as InsufficientBalanceError;
      expect(e.available).toBe(10_000);
      expect(e.requested).toBe(50_000);
    }
  });

  it("allows payment at exact balance (spendable === amountKobo)", () => {
    // Edge case: spendable exactly equals requested — should succeed
    mockDb.setState("available_balance_kobo", "50000");
    mockDb.setPendingOutgoing(0);
    mockDb.setNextSeq(1);

    // amountKobo = 50_000, spendable = 50_000 → senderBalanceAfterKobo = 0
    buildAndSignEnvelope(makeInput());

    const draftPassed = (signEnvelope as jest.Mock).mock.calls[0][0] as EnvelopeDraft;
    expect(draftPassed.senderBalanceAfterKobo).toBe(0);
  });

  it("prefers server-available balance over the raw verified balance cache", () => {
    mockDb.setState("verified_balance_kobo", "100000");
    mockDb.setState("available_balance_kobo", "40000");
    mockDb.setPendingOutgoing(5_000);
    mockDb.setNextSeq(1);

    expect(() => buildAndSignEnvelope(makeInput())).toThrow(
      InsufficientBalanceError,
    );
  });
});
