import {
  buildRecipientMismatchDebugMessage,
  isDuplicatePendingTransactionError,
  MERCHANT_SCAN_INVALID_QR_STATUS,
  parseScannedEnvelopePayload,
} from "../merchant-scan";

describe("parseScannedEnvelopePayload", () => {
  it("parses a raw envelope JSON payload", () => {
    const raw = JSON.stringify({
      version: 1,
      transactionId: "tx_1234567890abcdef",
    });

    const result = parseScannedEnvelopePayload(raw);

    expect(result).toEqual({
      ok: true,
      parsed: {
        version: 1,
        transactionId: "tx_1234567890abcdef",
      },
    });
  });

  it("returns invalid-qr status when JSON parsing fails", () => {
    const result = parseScannedEnvelopePayload("not-json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parse failure");
    }

    expect(result.status).toEqual(MERCHANT_SCAN_INVALID_QR_STATUS);
    expect(result.debugMessage).toMatch(/json parse failed/i);
  });
});

describe("isDuplicatePendingTransactionError", () => {
  it("detects SQLite duplicate constraint errors", () => {
    expect(
      isDuplicatePendingTransactionError(
        new Error("UNIQUE constraint failed: pending_transactions.id"),
      ),
    ).toBe(true);

    expect(
      isDuplicatePendingTransactionError(
        new Error("SQLITE_CONSTRAINT_PRIMARYKEY: duplicate key"),
      ),
    ).toBe(true);
  });

  it("does not mark unrelated errors as duplicates", () => {
    expect(
      isDuplicatePendingTransactionError(new Error("disk I/O error")),
    ).toBe(false);
  });
});

describe("buildRecipientMismatchDebugMessage", () => {
  it("includes both expected and actual merchant ids", () => {
    expect(
      buildRecipientMismatchDebugMessage(
        "u_expected12345678",
        "u_actual876543210",
      ),
    ).toBe(
      "recipient mismatch: expected u_expected12345678, got u_actual876543210",
    );
  });
});
