export const RECOVERY_APPROVAL_RETURN_TO =
  "/(onboarding)/scan-device-approval" as const;

export const RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE =
  "This recovery re-auth must use the same email that started this phone move.";
export const RECOVERY_ACTIVATION_USER_MISMATCH_MESSAGE =
  "This recovery session belongs to a different account. Sign in with the original email and try again.";

export function sanitizeRecoveryReauthReturnTo(
  value: string | undefined,
): typeof RECOVERY_APPROVAL_RETURN_TO | null {
  if (value === RECOVERY_APPROVAL_RETURN_TO) {
    return RECOVERY_APPROVAL_RETURN_TO;
  }
  return null;
}

export function canAccessRecoveryReauthVerifyRoute(input: {
  readonly pathname: string;
  readonly returnTo: string | undefined;
}): boolean {
  if (input.pathname !== "/(auth)/verify") {
    return false;
  }
  return sanitizeRecoveryReauthReturnTo(input.returnTo) !== null;
}

export function isAllowedRecoveryReauthEmail(input: {
  readonly recoveryReturnTo: typeof RECOVERY_APPROVAL_RETURN_TO | null;
  readonly requestedEmail: string;
  readonly expectedEmail: string | null;
}): boolean {
  if (input.recoveryReturnTo === null) {
    return true;
  }
  if (!input.expectedEmail) {
    return false;
  }
  return normalizeEmail(input.requestedEmail) === normalizeEmail(input.expectedEmail);
}

export function hasRecoveryActivationIdentityMismatch(input: {
  readonly expectedUserId: string | null;
  readonly expectedEmail: string | null;
  readonly currentUserId: string | null;
  readonly currentEmail: string | null;
}): boolean {
  if (!input.expectedUserId || !input.expectedEmail) {
    return false;
  }
  if (!input.currentUserId || !input.currentEmail) {
    return true;
  }
  return (
    input.expectedUserId !== input.currentUserId ||
    normalizeEmail(input.expectedEmail) !== normalizeEmail(input.currentEmail)
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
