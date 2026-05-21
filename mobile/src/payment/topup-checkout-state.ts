import type { TopupStatusResponse } from "../api/topup";

export type CheckoutPaymentStatus = "idle" | "pending" | "success" | "failed";

export interface ResolvedCheckoutStatusState {
  paymentStatus: Exclude<CheckoutPaymentStatus, "idle">;
  statusMessage: string;
  shouldSyncBalance: boolean;
}

export const TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE =
  "Payment page could not load. Please go back and try again.";

export function resolveCheckoutStatusState(
  topup: Pick<TopupStatusResponse, "status">,
): ResolvedCheckoutStatusState {
  if (topup.status === "SUCCESS") {
    return {
      paymentStatus: "success",
      statusMessage: "Your balance has been updated after payment confirmation.",
      shouldSyncBalance: true,
    };
  }

  if (topup.status === "FAILED" || topup.status === "EXPIRED") {
    return {
      paymentStatus: "failed",
      statusMessage:
        topup.status === "EXPIRED"
          ? "This payment session expired before confirmation. No balance was added."
          : "Payment was not confirmed. No balance was added.",
      shouldSyncBalance: false,
    };
  }

  return {
    paymentStatus: "pending",
    statusMessage:
      "Waiting for bank transfer confirmation. If you have made the transfer, your Oneto balance will update once payment is confirmed.",
    shouldSyncBalance: false,
  };
}
