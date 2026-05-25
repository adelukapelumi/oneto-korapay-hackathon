jest.mock("../../ledger/db", () => ({
  listPendingByStatus: jest.fn(),
}));

import { listPendingByStatus } from "../../ledger/db";
import {
  buildMerchantBalanceProjection,
  getActiveCashoutSummary,
  getCashoutBalanceDisplay,
  getCashoutRequestDecision,
  getPendingIncomingSummary,
  shouldStartCashoutBalanceRefresh,
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
        cashoutableBalanceKobo: 150_000,
      }),
    ).toEqual({ canRequestCashout: true });
  });

  it("blocks cashout while balance confirmation is in progress", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 150_000,
        isRequestInProgress: true,
      }),
    ).toEqual({ canRequestCashout: false, reason: "request_in_progress" });
  });

  it("blocks cashout when backend balance is unconfirmed", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: false,
        cashoutableBalanceKobo: 150_000,
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
        cashoutableBalanceKobo: 150_000,
      }),
    ).toEqual({ canRequestCashout: false, reason: "jwt_stale" });
  });

  it("blocks cashout when confirmed balance is below minimum cashout threshold", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 99_999,
      }),
    ).toEqual({ canRequestCashout: false, reason: "below_minimum_cashout" });
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

  it("blocks another cashout when a backend active cashout exists", () => {
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: true,
        cashoutableBalanceKobo: 150_000,
        activeCashout: { amountKobo: 150_000, grossAmountKobo: 150_000, status: "PENDING" },
      }),
    ).toEqual({ canRequestCashout: false, reason: "active_cashout" });
  });

  it("uses backend active cashout status to show zero available for cashout", () => {
    expect(
      getCashoutBalanceDisplay({
        fetchState: "confirmed",
        cashoutableBalanceKobo: 20_000,
        activeCashout: { amountKobo: 20_000, grossAmountKobo: 20_000, status: "PROCESSING" },
      }),
    ).toEqual({ kind: "amount", cashoutableBalanceKobo: 0 });
  });

  it("renders confirmed backend balance when no active cashout exists", () => {
    expect(
      getCashoutBalanceDisplay({
        fetchState: "confirmed",
        cashoutableBalanceKobo: 20_000,
        activeCashout: null,
      }),
    ).toEqual({ kind: "amount", cashoutableBalanceKobo: 20_000 });
  });

  it("renders confirm online while offline and disables request through unconfirmed balance", () => {
    expect(
      getCashoutBalanceDisplay({
        fetchState: "offline_unconfirmed",
        cashoutableBalanceKobo: 20_000,
        activeCashout: null,
      }),
    ).toEqual({ kind: "confirm_online" });
    expect(
      getCashoutRequestDecision({
        jwtFresh: true,
        balanceConfirmedOnline: false,
        cashoutableBalanceKobo: 20_000,
      }),
    ).toEqual({ canRequestCashout: false, reason: "balance_unconfirmed" });
  });

  it("does not leave balance display loading after a fetch error state", () => {
    expect(
      getCashoutBalanceDisplay({
        fetchState: "error",
        cashoutableBalanceKobo: 20_000,
        activeCashout: null,
      }),
    ).toEqual({ kind: "confirm_online" });
  });

  it("represents the loading state explicitly while confirmation is in flight", () => {
    expect(
      getCashoutBalanceDisplay({
        fetchState: "loading",
        cashoutableBalanceKobo: 20_000,
        activeCashout: null,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("finds active cashouts from backend status and ignores terminal cashouts", () => {
    expect(
      getActiveCashoutSummary([
        {
          amountKobo: "5000",
          status: "COMPLETED",
        },
        {
          amountKobo: "2500",
          grossAmountKobo: "2500",
          status: "PENDING",
        },
      ]),
    ).toEqual({ amountKobo: 2_500, grossAmountKobo: 2_500, status: "PENDING" });

    expect(
      getActiveCashoutSummary([
        {
          amountKobo: "5000",
          status: "COMPLETED",
        },
        {
          amountKobo: "2500",
          status: "FAILED",
        },
      ]),
    ).toBeNull();
  });

  it("does not start overlapping balance refreshes on re-focus", () => {
    expect(
      shouldStartCashoutBalanceRefresh({
        isAuthed: true,
        isRefreshInFlight: true,
      }),
    ).toBe(false);
    expect(
      shouldStartCashoutBalanceRefresh({
        isAuthed: true,
        isRefreshInFlight: false,
      }),
    ).toBe(true);
  });
});
