export const RECOVERY_APPROVAL_RETURN_TO =
  "/(onboarding)/scan-device-approval" as const;
export const APP_HOME_RETURN_TO = "/(app)/home" as const;
export const APP_SETTINGS_RETURN_TO = "/(app)/settings" as const;
export const APP_APPROVE_NEW_PHONE_RETURN_TO =
  "/(app)/approve-new-phone" as const;

export const RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE =
  "Use the same email for this device.";
export const RECOVERY_ACTIVATION_USER_MISMATCH_MESSAGE =
  "This recovery session belongs to a different account. Sign in with the original email and try again.";

const ALLOWED_REAUTH_RETURN_TO = [
  RECOVERY_APPROVAL_RETURN_TO,
  APP_HOME_RETURN_TO,
  APP_SETTINGS_RETURN_TO,
  APP_APPROVE_NEW_PHONE_RETURN_TO,
] as const;

export type AllowedReauthReturnTo = (typeof ALLOWED_REAUTH_RETURN_TO)[number];

export function sanitizeRecoveryReauthReturnTo(
  value: string | undefined,
): AllowedReauthReturnTo | null {
  if (
    value === RECOVERY_APPROVAL_RETURN_TO ||
    value === APP_HOME_RETURN_TO ||
    value === APP_SETTINGS_RETURN_TO ||
    value === APP_APPROVE_NEW_PHONE_RETURN_TO
  ) {
    return value;
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
  readonly recoveryReturnTo: AllowedReauthReturnTo | null;
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
