export const RECOVERY_APPROVAL_RETURN_TO =
  "/(onboarding)/scan-device-approval" as const;

export function sanitizeRecoveryReauthReturnTo(
  value: string | undefined,
): typeof RECOVERY_APPROVAL_RETURN_TO | null {
  if (value === RECOVERY_APPROVAL_RETURN_TO) {
    return RECOVERY_APPROVAL_RETURN_TO;
  }
  return null;
}
