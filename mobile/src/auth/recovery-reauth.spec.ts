import {
  RECOVERY_APPROVAL_RETURN_TO,
  sanitizeRecoveryReauthReturnTo,
} from "./recovery-reauth";

describe("recovery re-auth return-to", () => {
  it("accepts the approved recovery scan route", () => {
    expect(
      sanitizeRecoveryReauthReturnTo(RECOVERY_APPROVAL_RETURN_TO),
    ).toBe(RECOVERY_APPROVAL_RETURN_TO);
  });

  it("rejects unknown routes", () => {
    expect(sanitizeRecoveryReauthReturnTo("/(app)/home")).toBeNull();
    expect(sanitizeRecoveryReauthReturnTo("/(onboarding)/move-device")).toBeNull();
  });
});
