export interface MerchantScanStatus {
  readonly title: string;
  readonly message: string;
}

export const MERCHANT_SCAN_IDLE_STATUS: MerchantScanStatus = {
  title: "Scan student payment QR",
  message:
    "Ask the student to select your business, enter the amount, confirm with PIN, and show their payment QR.",
};

export const MERCHANT_SCAN_DETECTED_STATUS: MerchantScanStatus = {
  title: "QR detected",
  message: "Checking the signed payment now...",
};

export const MERCHANT_SCAN_SAVING_STATUS: MerchantScanStatus = {
  title: "Payment verified",
  message: "Saving this incoming payment on your device...",
};

export const MERCHANT_SCAN_SUCCESS_STATUS: MerchantScanStatus = {
  title: "Payment verified",
  message: "Payment saved locally. Opening the success screen...",
};

export const MERCHANT_SCAN_INVALID_QR_STATUS: MerchantScanStatus = {
  title: "Invalid QR",
  message: "This QR code is not a valid oneto payment.",
};

export const MERCHANT_SCAN_INVALID_PAYMENT_STATUS: MerchantScanStatus = {
  title: "Invalid payment",
  message: "The signed payment could not be verified.",
};

export const MERCHANT_SCAN_WRONG_MERCHANT_STATUS: MerchantScanStatus = {
  title: "Wrong merchant",
  message: "This payment is not addressed to this merchant account.",
};

export const MERCHANT_SCAN_DUPLICATE_STATUS: MerchantScanStatus = {
  title: "Payment already scanned",
  message: "This payment has already been scanned on this device.",
};

export const MERCHANT_SCAN_SAVE_FAILED_STATUS: MerchantScanStatus = {
  title: "Save failed",
  message: "Could not save the payment data on this device.",
};

export const MERCHANT_SCAN_CAMERA_ERROR_STATUS: MerchantScanStatus = {
  title: "Camera unavailable",
  message: "The scanner could not start. Close this screen and try again.",
};

export const MERCHANT_SCAN_BALANCE_FAILED_STATUS: MerchantScanStatus = {
  title: "Balance check failed",
  message: "Could not validate merchant balance headroom for this payment.",
};

export const MERCHANT_SCAN_HEADROOM_EXCEEDED_STATUS: MerchantScanStatus = {
  title: "Cannot accept payment",
  message:
    "This payment would push your merchant balance above the allowed limit. Reconcile or cash out first, then try again.",
};

export type MerchantScanParseResult =
  | { readonly ok: true; readonly parsed: unknown }
  | {
      readonly ok: false;
      readonly status: MerchantScanStatus;
      readonly debugMessage: string;
    };

export function parseScannedEnvelopePayload(
  rawData: string,
): MerchantScanParseResult {
  try {
    return { ok: true, parsed: JSON.parse(rawData) };
  } catch {
    return {
      ok: false,
      status: MERCHANT_SCAN_INVALID_QR_STATUS,
      debugMessage: `json parse failed for payload length ${rawData.length}`,
    };
  }
}

export function isDuplicatePendingTransactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unique constraint|primary key|sqlite_constraint/i.test(message);
}

export function buildRecipientMismatchDebugMessage(
  expectedMerchantUserId: string,
  envelopeRecipientUserId: string,
): string {
  return `recipient mismatch: expected ${expectedMerchantUserId}, got ${envelopeRecipientUserId}`;
}
