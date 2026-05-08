import { initiateTopup } from "../api/topup";

// Backend DTO constraints from topup.controller.ts
export const MIN_TOPUP_KOBO = 10_000;        // ₦100
export const MAX_TOPUP_KOBO = 100_000_000;   // ₦1,000,000

export class TopupAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopupAmountError";
  }
}

export async function requestTopup(amountKobo: number): Promise<{
  reference: string;
  paymentUrl: string;
}> {
  if (!Number.isInteger(amountKobo)) {
    throw new TopupAmountError("Amount must be a whole number");
  }
  if (amountKobo < MIN_TOPUP_KOBO) {
    throw new TopupAmountError(`Minimum top-up is ₦${MIN_TOPUP_KOBO / 100}`);
  }
  if (amountKobo > MAX_TOPUP_KOBO) {
    throw new TopupAmountError(`Maximum top-up is ₦${(MAX_TOPUP_KOBO / 100).toLocaleString()}`);
  }
  return initiateTopup(amountKobo);
}
