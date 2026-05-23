import {
  FINAL_PAYOUT_PENDING_TEXT,
  KORAPAY_PAYOUT_FEE_PENDING_TEXT,
  getFinalMerchantPayoutText,
  getKorapayPayoutFeeText,
} from "../cashout-fee-display";

describe("cashout fee display", () => {
  it("shows Korapay payout fee pending confirmation while fee bearer is unknown", () => {
    const cashout = {
      korapayPayoutFeeBearer: "UNKNOWN",
      korapayPayoutFeeKobo: null,
      netPayoutKobo: null,
      korapayTransferAmountKobo: null,
    };

    expect(getKorapayPayoutFeeText(cashout)).toBe(KORAPAY_PAYOUT_FEE_PENDING_TEXT);
    expect(getFinalMerchantPayoutText(cashout)).toBe(FINAL_PAYOUT_PENDING_TEXT);
  });

  it("does not subtract a returned Korapay fee when it is recorded as Oneto processor cost", () => {
    const cashout = {
      korapayPayoutFeeBearer: "ONETO",
      korapayPayoutFeeKobo: "2500",
      netPayoutKobo: "975000",
      korapayTransferAmountKobo: "975000",
    };

    expect(getKorapayPayoutFeeText(cashout)).toBe("\u20A625.00 recorded as processor fee");
    expect(getFinalMerchantPayoutText(cashout)).toBe("\u20A69750.00");
  });

  it("shows merchant-borne payout fee only when recipient deduction is confirmed", () => {
    const cashout = {
      korapayPayoutFeeBearer: "MERCHANT",
      korapayPayoutFeeKobo: "2500",
      netPayoutKobo: "972500",
      korapayTransferAmountKobo: "975000",
    };

    expect(getKorapayPayoutFeeText(cashout)).toBe("\u20A625.00");
    expect(getFinalMerchantPayoutText(cashout)).toBe("\u20A69725.00");
  });
});
