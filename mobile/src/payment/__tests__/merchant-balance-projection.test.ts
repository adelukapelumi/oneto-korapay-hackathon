jest.mock("../../ledger/db", () => ({
  listPendingByStatus: jest.fn(),
}));

import { listPendingByStatus } from "../../ledger/db";
import {
  buildMerchantBalanceProjection,
  getCashoutRequestDecision,
  getPendingIncomingSummary,
} from "../merchant-balance-projection";

const listPendingByStatusMock =
  listPendingByStatus as jest.MockedFunction<typeof listPendingByStatus>;

describe("merchant balance projection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listPendingByStatusMock.mockReturnValue([]);
  });

  it("projects settled balance only as cashoutable", () => {
    const projection = buildMerchantBalanceProjection({
      settledBalanceKobo: 1_200_000,
      pendingIncomingKobo: 0,
      pendingIncomingCount: 0,
    });

    expect(projection).toEqual({
      settledBalanceKobo: 1_200_000,
      pendingIncomingKobo: 0,
      pendingIncomingCount: 0,
      cashoutableBalanceKobo: 1_200_000,
      hasPendingSync: false,
    });
  });

  it("separates pending incoming from cashoutable balance", () => {
    const projection = buildMerchantBalanceProjection({
      settledBalanceKobo: 0,
      pendingIncomingKobo: 1_200_000,
      pendingIncomingCount: 6,
    });

    expect(projection.pendingIncomingKobo).toBe(1_200_000);
    expect(projection.cashoutableBalanceKobo).toBe(0);
    expect(projection.hasPendingSync).toBe(true);
  });

  it("keeps partial sync pending incoming out of cashoutable balance", () => {
    const projection = buildMerchantBalanceProjection({
      settledBalanceKobo: 800_000,
      pendingIncomingKobo: 400_000,
      pendingIncomingCount: 2,
    });

    expect(projection.settledBalanceKobo).toBe(800_000);
    expect(projection.pendingIncomingKobo).toBe(400_000);
    expect(projection.cashoutableBalanceKobo).toBe(800_000);
  });

  it("sums only active pending incoming rows from local DB helper", () => {
    listPendingByStatusMock.mockReturnValue([
      {
        id: "tx_1",
        envelopeJson: "{}",
        recipientId: "u_merchant000000001",
        recipientLabel: null,
        amountKobo: 250_000,
        sequenceNumber: 1,
        direction: "incoming",
        status: "pending_reconciliation",
        terminalReason: null,
        createdAt: "2026-05-01T10:00:00.000Z",
        reconciledAt: null,
      },
      {
        id: "tx_2",
        envelopeJson: "{}",
        recipientId: "u_merchant000000001",
        recipientLabel: null,
        amountKobo: 150_000,
        sequenceNumber: 2,
        direction: "incoming",
        status: "pending_reconciliation",
        terminalReason: null,
        createdAt: "2026-05-01T10:01:00.000Z",
        reconciledAt: null,
      },
    ]);

    expect(getPendingIncomingSummary()).toEqual({
      pendingIncomingKobo: 400_000,
      pendingIncomingCount: 2,
    });
    expect(listPendingByStatus).toHaveBeenCalledWith(
      "pending_reconciliation",
      "incoming",
    );
  });

  it("allows cashout only with fresh jwt, confirmed balance, and positive cashoutable balance", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 1_000,
      }),
    ).toEqual({ canRequestCashout: true });
  });

  it("blocks cashout when backend balance is unconfirmed", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: false,
        cashoutableBalanceKobo: 1_000,
      }),
    ).toEqual({
      canRequestCashout: false,
      reason: "balance_unconfirmed",
    });
  });

  it("blocks cashout when jwt is stale", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: false,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 1_000,
      }),
    ).toEqual({ canRequestCashout: false, reason: "jwt_stale" });
  });

  it("blocks cashout when cashoutable balance is zero", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 0,
      }),
    ).toEqual({ canRequestCashout: false, reason: "zero_balance" });
  });
});
