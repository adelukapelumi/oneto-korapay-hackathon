jest.mock("../../ledger/db", () => ({
  sumPendingIncomingKobo: jest.fn(),
}));

import { MAX_USER_BALANCE_KOBO } from "@oneto/shared/src/types/limits";
import { sumPendingIncomingKobo } from "../../ledger/db";
import {
  assertIncomingWithinRegulatoryHeadroom,
  MerchantBalanceCapExceededError,
  parseVerifiedBalanceKoboOrThrow,
} from "../incoming-headroom";

const sumPendingIncomingKoboMock = sumPendingIncomingKobo as jest.MockedFunction<
  typeof sumPendingIncomingKobo
>;

describe("incoming headroom", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sumPendingIncomingKoboMock.mockReturnValue(0);
  });

  it("allows acceptance when projected balance is within cap", () => {
    sumPendingIncomingKoboMock.mockReturnValue(50_000);
    expect(() =>
      assertIncomingWithinRegulatoryHeadroom(4_900_000, 20_000),
    ).not.toThrow();
  });

  it("blocks acceptance when projected balance exceeds cap", () => {
    sumPendingIncomingKoboMock.mockReturnValue(10_000);

    expect(() =>
      assertIncomingWithinRegulatoryHeadroom(MAX_USER_BALANCE_KOBO, 1),
    ).toThrow(MerchantBalanceCapExceededError);
  });

  it("counts pending incoming in projection", () => {
    sumPendingIncomingKoboMock.mockReturnValue(100_000);

    expect(() =>
      assertIncomingWithinRegulatoryHeadroom(4_950_000, 1),
    ).toThrow(MerchantBalanceCapExceededError);
  });

  it("does not double-count reconciled incoming when pending sum excludes it", () => {
    // This matches ledger query semantics: only pending_reconciliation rows count.
    sumPendingIncomingKoboMock.mockReturnValue(5_000);

    expect(() =>
      assertIncomingWithinRegulatoryHeadroom(4_994_000, 1_000),
    ).not.toThrow();
  });

  it("keeps student/payor flow unaffected by not including outgoing pending sums", () => {
    // If outgoing were incorrectly included, this would exceed cap.
    sumPendingIncomingKoboMock.mockReturnValue(0);

    expect(() =>
      assertIncomingWithinRegulatoryHeadroom(4_999_000, 1_000),
    ).not.toThrow();
  });

  it("parses verified balance string as integer kobo", () => {
    expect(parseVerifiedBalanceKoboOrThrow("5000000")).toBe(5_000_000);
  });
});
