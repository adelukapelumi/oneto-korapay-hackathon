export const KORAPAY_PAYOUT_FEE_PENDING_TEXT =
  "Korapay payout fee pending confirmation.";
export const FINAL_PAYOUT_PENDING_TEXT = "pending payout fee confirmation";

type CashoutFeeDisplayInput = {
  readonly korapayPayoutFeeBearer: string;
  readonly korapayPayoutFeeKobo: string | null;
  readonly netPayoutKobo: string | null;
  readonly korapayTransferAmountKobo: string | null;
};

export function formatCashoutKobo(amountKobo: number | string | null | undefined): string {
  if (amountKobo === null || amountKobo === undefined) {
    return "to be confirmed";
  }

  const amountNumber =
    typeof amountKobo === "string" ? Number(amountKobo) : amountKobo;
  if (!Number.isFinite(amountNumber)) {
    return "to be confirmed";
  }

  return `${"\u20A6"}${(amountNumber / 100).toFixed(2)}`;
}

export function getKorapayPayoutFeeText(cashout: CashoutFeeDisplayInput): string {
  if (cashout.korapayPayoutFeeBearer === "MERCHANT") {
    return formatCashoutKobo(cashout.korapayPayoutFeeKobo);
  }

  if (cashout.korapayPayoutFeeBearer === "ONETO" && cashout.korapayPayoutFeeKobo) {
    return `${formatCashoutKobo(cashout.korapayPayoutFeeKobo)} recorded as processor fee`;
  }

  return KORAPAY_PAYOUT_FEE_PENDING_TEXT;
}

export function getFinalMerchantPayoutText(cashout: CashoutFeeDisplayInput): string {
  if (cashout.korapayPayoutFeeBearer === "UNKNOWN") {
    return FINAL_PAYOUT_PENDING_TEXT;
  }

  const finalPayoutKobo =
    cashout.netPayoutKobo ??
    (cashout.korapayPayoutFeeBearer === "ONETO"
      ? cashout.korapayTransferAmountKobo
      : null);

  return finalPayoutKobo
    ? formatCashoutKobo(finalPayoutKobo)
    : FINAL_PAYOUT_PENDING_TEXT;
}
