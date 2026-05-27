import {
  canAccessRecoveryReauthVerifyRoute,
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

  it("allows recovery pending OTP verify route only with approved returnTo", () => {
    expect(
      canAccessRecoveryReauthVerifyRoute({
        pathname: "/(auth)/verify",
        returnTo: RECOVERY_APPROVAL_RETURN_TO,
      }),
    ).toBe(true);
    expect(
      canAccessRecoveryReauthVerifyRoute({
        pathname: "/(auth)/verify",
        returnTo: "/(app)/home",
      }),
    ).toBe(false);
    expect(
      canAccessRecoveryReauthVerifyRoute({
        pathname: "/(auth)/sign-in",
        returnTo: RECOVERY_APPROVAL_RETURN_TO,
      }),
    ).toBe(false);
  });
});
