import {
  hasRecoveryActivationIdentityMismatch,
  isAllowedRecoveryReauthEmail,
  RECOVERY_ACTIVATION_USER_MISMATCH_MESSAGE,
  RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE,
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

  it("allows recovery re-auth only for the same expected email", () => {
    expect(
      isAllowedRecoveryReauthEmail({
        recoveryReturnTo: RECOVERY_APPROVAL_RETURN_TO,
        requestedEmail: "oadeluka.2202531@stu.cu.edu.ng",
        expectedEmail: "oadeluka.2202531@stu.cu.edu.ng",
      }),
    ).toBe(true);
    expect(
      isAllowedRecoveryReauthEmail({
        recoveryReturnTo: RECOVERY_APPROVAL_RETURN_TO,
        requestedEmail: "other@stu.cu.edu.ng",
        expectedEmail: "oadeluka.2202531@stu.cu.edu.ng",
      }),
    ).toBe(false);
    expect(RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE).toContain("same email");
  });

  it("detects recovery activation user/email mismatch", () => {
    expect(
      hasRecoveryActivationIdentityMismatch({
        expectedUserId: "u_a",
        expectedEmail: "a@stu.cu.edu.ng",
        currentUserId: "u_a",
        currentEmail: "a@stu.cu.edu.ng",
      }),
    ).toBe(false);
    expect(
      hasRecoveryActivationIdentityMismatch({
        expectedUserId: "u_a",
        expectedEmail: "a@stu.cu.edu.ng",
        currentUserId: "u_b",
        currentEmail: "b@stu.cu.edu.ng",
      }),
    ).toBe(true);
    expect(RECOVERY_ACTIVATION_USER_MISMATCH_MESSAGE).toContain("different account");
  });
});
