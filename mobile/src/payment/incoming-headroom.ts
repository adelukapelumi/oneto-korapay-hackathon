import { MAX_USER_BALANCE_KOBO } from "@oneto/shared/src/types/limits";
import { sumPendingIncomingKobo } from "../ledger/db";

export class MerchantBalanceCapExceededError extends Error {
  public readonly projectedBalanceKobo: number;

  constructor(projectedBalanceKobo: number) {
    super(
      `Projected merchant balance ${projectedBalanceKobo} exceeds MAX_USER_BALANCE_KOBO ${MAX_USER_BALANCE_KOBO}`,
    );
    this.name = "MerchantBalanceCapExceededError";
    this.projectedBalanceKobo = projectedBalanceKobo;
  }
}

export function parseVerifiedBalanceKoboOrThrow(verifiedBalanceRaw: string): number {
  const verifiedBalanceKobo = parseInt(verifiedBalanceRaw, 10);
  if (!Number.isInteger(verifiedBalanceKobo) || verifiedBalanceKobo < 0) {
    throw new Error(
      `Stored verified balance is not a valid non-negative integer: "${verifiedBalanceRaw}"`,
    );
  }
  return verifiedBalanceKobo;
}

export function assertIncomingWithinRegulatoryHeadroom(
  verifiedBalanceKobo: number,
  incomingAmountKobo: number,
): void {
  if (!Number.isInteger(verifiedBalanceKobo) || verifiedBalanceKobo < 0) {
    throw new Error(`verifiedBalanceKobo must be a non-negative integer, got ${verifiedBalanceKobo}`);
  }
  if (!Number.isInteger(incomingAmountKobo) || incomingAmountKobo <= 0) {
    throw new Error(`incomingAmountKobo must be a positive integer, got ${incomingAmountKobo}`);
  }

  const pendingIncomingKobo = sumPendingIncomingKobo();
  const projectedBalanceKobo =
    verifiedBalanceKobo + pendingIncomingKobo + incomingAmountKobo;

  if (projectedBalanceKobo > MAX_USER_BALANCE_KOBO) {
    throw new MerchantBalanceCapExceededError(projectedBalanceKobo);
  }
}
