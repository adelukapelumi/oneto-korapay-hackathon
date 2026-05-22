import { listPendingByStatus } from "../ledger/db";

export interface MerchantBalanceProjection {
  readonly settledBalanceKobo: number;
  readonly pendingIncomingKobo: number;
  readonly pendingIncomingCount: number;
  readonly cashoutableBalanceKobo: number;
  readonly hasPendingSync: boolean;
}

export interface PendingIncomingSummary {
  readonly pendingIncomingKobo: number;
  readonly pendingIncomingCount: number;
}

export type CashoutRequestBlockReason =
  | "jwt_stale"
  | "balance_unconfirmed"
  | "zero_balance"
  | "request_in_progress";

export type CashoutRequestDecision =
  | { readonly canRequestCashout: true }
  | {
      readonly canRequestCashout: false;
      readonly reason: CashoutRequestBlockReason;
    };

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer kobo value`);
  }
}

export function buildMerchantBalanceProjection(input: {
  readonly settledBalanceKobo: number;
  readonly pendingIncomingKobo: number;
  readonly pendingIncomingCount: number;
}): MerchantBalanceProjection {
  assertNonNegativeInteger("settledBalanceKobo", input.settledBalanceKobo);
  assertNonNegativeInteger("pendingIncomingKobo", input.pendingIncomingKobo);
  assertNonNegativeInteger("pendingIncomingCount", input.pendingIncomingCount);

  return {
    settledBalanceKobo: input.settledBalanceKobo,
    pendingIncomingKobo: input.pendingIncomingKobo,
    pendingIncomingCount: input.pendingIncomingCount,
    // Today the backend blocks a second active cashout instead of exposing
    // local holds. Do not subtract local pending captures here: they are not
    // backend-settled and are not cashoutable.
    cashoutableBalanceKobo: input.settledBalanceKobo,
    hasPendingSync: input.pendingIncomingCount > 0,
  };
}

export function getPendingIncomingSummary(): PendingIncomingSummary {
  const pendingIncoming = listPendingByStatus(
    "pending_reconciliation",
    "incoming",
  );

  const pendingIncomingKobo = pendingIncoming.reduce((sum, tx) => {
    assertNonNegativeInteger("pending incoming amountKobo", tx.amountKobo);
    return sum + tx.amountKobo;
  }, 0);

  return {
    pendingIncomingKobo,
    pendingIncomingCount: pendingIncoming.length,
  };
}

export function getCashoutRequestDecision(input: {
  readonly jwtFresh: boolean;
  readonly balanceConfirmedOnline: boolean;
  readonly cashoutableBalanceKobo: number;
  readonly isRequestInProgress?: boolean;
}): CashoutRequestDecision {
  assertNonNegativeInteger(
    "cashoutableBalanceKobo",
    input.cashoutableBalanceKobo,
  );

  if (input.isRequestInProgress) {
    return { canRequestCashout: false, reason: "request_in_progress" };
  }
  if (!input.jwtFresh) {
    return { canRequestCashout: false, reason: "jwt_stale" };
  }
  if (!input.balanceConfirmedOnline) {
    return { canRequestCashout: false, reason: "balance_unconfirmed" };
  }
  if (input.cashoutableBalanceKobo <= 0) {
    return { canRequestCashout: false, reason: "zero_balance" };
  }

  return { canRequestCashout: true };
}
