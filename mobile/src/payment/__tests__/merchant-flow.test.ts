import {
  MERCHANT_SCAN_CTA,
  MERCHANT_SCAN_INSTRUCTION,
  MERCHANT_SCAN_ROUTE,
  MERCHANT_SCAN_SUCCESS_CTA,
  MERCHANT_SCAN_TITLE,
  ONBOARDING_STUDENT_PAYMENT_COPY,
} from "../merchant-flow";

describe("merchant flow copy", () => {
  it("points merchants to the scanner route", () => {
    expect(MERCHANT_SCAN_ROUTE).toBe("/(app)/merchant/scan-envelope");
  });

  it("uses student-led merchant scanner copy", () => {
    expect(MERCHANT_SCAN_CTA).toBe("Scan QR");
    expect(MERCHANT_SCAN_TITLE).toBe("Scan student payment QR");
    expect(MERCHANT_SCAN_INSTRUCTION).toBe(
      "Ask the student to select your business, enter the amount, confirm with PIN, and show their payment QR.",
    );
    expect(MERCHANT_SCAN_SUCCESS_CTA).toBe("Scan Another QR →");
  });

  it("uses student-led onboarding payment copy", () => {
    expect(ONBOARDING_STUDENT_PAYMENT_COPY).toBe(
      "Choose an approved merchant, enter the amount, confirm with your PIN, and show your payment QR.",
    );
  });
});
