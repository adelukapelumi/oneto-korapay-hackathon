import type { StudentBalanceProjection } from "./balance-snapshot";

export interface TopupBalanceDisplay {
  readonly currentBalanceKobo: number;
  readonly newBalanceKobo: number;
  readonly pendingOutgoingKobo: number;
  readonly pendingOutgoingCount: number;
  readonly isProjected: boolean;
}

export function buildTopupBalanceDisplay(input: {
  readonly projection: StudentBalanceProjection | null;
  readonly fallbackServerBalanceKobo: number;
  readonly topupAmountKobo: number;
}): TopupBalanceDisplay {
  if (
    !Number.isSafeInteger(input.fallbackServerBalanceKobo) ||
    input.fallbackServerBalanceKobo < 0
  ) {
    throw new Error("fallbackServerBalanceKobo must be a non-negative integer");
  }
  if (!Number.isSafeInteger(input.topupAmountKobo) || input.topupAmountKobo < 0) {
    throw new Error("topupAmountKobo must be a non-negative integer");
  }

  const currentBalanceKobo =
    input.projection?.availableBalanceKobo ?? input.fallbackServerBalanceKobo;
  const pendingOutgoingKobo = input.projection?.pendingOutgoingKobo ?? 0;
  const pendingOutgoingCount = input.projection?.pendingOutgoingCount ?? 0;

  return {
    currentBalanceKobo,
    newBalanceKobo: currentBalanceKobo + input.topupAmountKobo,
    pendingOutgoingKobo,
    pendingOutgoingCount,
    isProjected: input.projection !== null,
  };
}
