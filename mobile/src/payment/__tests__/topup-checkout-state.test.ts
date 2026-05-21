import {
  resolveCheckoutStatusState,
  TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE,
} from "../topup-checkout-state";

describe("resolveCheckoutStatusState", () => {
  it("keeps pending top-ups in a non-success state without syncing balance", () => {
    expect(resolveCheckoutStatusState({ status: "PENDING" })).toEqual({
      paymentStatus: "pending",
      statusMessage:
        "Waiting for bank transfer confirmation. If you have made the transfer, your Oneto balance will update once payment is confirmed.",
      shouldSyncBalance: false,
    });
  });

  it("marks successful top-ups as success and requests a balance sync", () => {
    expect(resolveCheckoutStatusState({ status: "SUCCESS" })).toEqual({
      paymentStatus: "success",
      statusMessage: "Your balance has been updated after payment confirmation.",
      shouldSyncBalance: true,
    });
  });

  it("returns the explicit WebView load error message", () => {
    expect(TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE).toBe(
      "Payment page could not load. Please go back and try again.",
    );
  });
});
