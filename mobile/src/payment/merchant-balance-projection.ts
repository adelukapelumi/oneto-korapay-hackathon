import { listPendingByStatus } from "../ledger/db";
// TODO(post-pilot): expose a lightweight shared limits entrypoint
// (for example "@oneto/shared/limits") so mobile can import these
// constants without referencing /src paths.
import { MIN_CASHOUT_GROSS_KOBO } from "@oneto/shared/src/types/limits";

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

export type CashoutBalanceFetchState =
  | "loading"
  | "confirmed"
  | "offline_unconfirmed"
  | "error";

export interface ActiveCashoutSummary {
  readonly amountKobo: number;
  readonly grossAmountKobo: number;
  readonly status: string;
}

export interface CashoutStatusLike {
  readonly amountKobo: string;
  readonly grossAmountKobo?: string;
  readonly status: string;
}

export type CashoutBalanceDisplay =
  | { readonly kind: "loading" }
  | { readonly kind: "confirm_online" }
  | {
      readonly kind: "amount";
      readonly cashoutableBalanceKobo: number;
    };

export type CashoutRequestBlockReason =
  | "jwt_stale"
  | "balance_unconfirmed"
  | "zero_balance"
  | "below_minimum_cashout"
  | "request_in_progress"
  | "active_cashout";

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

export function getActiveCashoutSummary(
  cashouts: readonly CashoutStatusLike[],
): ActiveCashoutSummary | null {
  const active = cashouts.find((cashout) =>
    ["PENDING", "APPROVED", "PROCESSING"].includes(cashout.status),
  );

  if (!active) {
    return null;
  }

  const amountKobo = Number(active.grossAmountKobo ?? active.amountKobo);
  assertNonNegativeInteger("active cashout amountKobo", amountKobo);

  return {
    amountKobo,
    grossAmountKobo: amountKobo,
    status: active.status,
  };
}

export function shouldStartCashoutBalanceRefresh(input: {
  readonly isAuthed: boolean;
  readonly isRefreshInFlight: boolean;
}): boolean {
  return input.isAuthed && !input.isRefreshInFlight;
}

export function getCashoutBalanceDisplay(input: {
  readonly fetchState: CashoutBalanceFetchState;
  readonly cashoutableBalanceKobo: number;
  readonly activeCashout: ActiveCashoutSummary | null;
}): CashoutBalanceDisplay {
  assertNonNegativeInteger(
    "cashoutableBalanceKobo",
    input.cashoutableBalanceKobo,
  );

  if (input.fetchState === "loading") {
    return { kind: "loading" };
  }

  if (input.fetchState !== "confirmed") {
    return { kind: "confirm_online" };
  }

  return {
    kind: "amount",
    cashoutableBalanceKobo: input.activeCashout
      ? 0
      : input.cashoutableBalanceKobo,
  };
}

export function getCashoutRequestDecision(input: {
  readonly jwtFresh: boolean;
  readonly balanceConfirmedOnline: boolean;
  readonly cashoutableBalanceKobo: number;
  readonly minimumCashoutGrossKobo?: number;
  readonly isRequestInProgress?: boolean;
  readonly activeCashout?: ActiveCashoutSummary | null;
}): CashoutRequestDecision {
  const minimumCashoutGrossKobo =
    input.minimumCashoutGrossKobo ?? MIN_CASHOUT_GROSS_KOBO;

  assertNonNegativeInteger(
    "cashoutableBalanceKobo",
    input.cashoutableBalanceKobo,
  );
  assertNonNegativeInteger(
    "minimumCashoutGrossKobo",
    minimumCashoutGrossKobo,
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
  if (input.activeCashout) {
    return { canRequestCashout: false, reason: "active_cashout" };
  }
  if (input.cashoutableBalanceKobo <= 0) {
    return { canRequestCashout: false, reason: "zero_balance" };
  }
  if (input.cashoutableBalanceKobo < minimumCashoutGrossKobo) {
    return { canRequestCashout: false, reason: "below_minimum_cashout" };
  }

  return { canRequestCashout: true };
}
