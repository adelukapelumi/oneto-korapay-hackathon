import type { RecoveryReason } from "../api/recovery";

export const SUPPORT_EMAIL_ADDRESS = "support@getoneto.com";

export type DeviceLinkedAction = {
  readonly label: string;
  readonly pathname: string;
  readonly params?: Record<string, string>;
};

export const RECOVERY_REASON_OPTIONS: readonly {
  readonly value: RecoveryReason;
  readonly label: string;
}[] = [
  { value: "NEW_PHONE", label: "New phone" },
  { value: "LOST_PHONE", label: "Lost phone" },
  { value: "STOLEN_PHONE", label: "Phone was stolen" },
  { value: "DAMAGED_PHONE", label: "Phone was damaged" },
  { value: "APP_UNINSTALLED", label: "App was uninstalled" },
  { value: "APP_DATA_CLEARED", label: "App data was cleared" },
  { value: "FACTORY_RESET", label: "Factory reset" },
  { value: "FORGOT_PIN", label: "Forgot PIN" },
  { value: "KEYPAIR_WIPED", label: "Keypair was wiped" },
  { value: "OTHER", label: "Other" },
] as const;

export const RECOVERY_REQUEST_WARNINGS = [
  "Oneto Support will never ask for your PIN or OTP.",
  "Do not uninstall Oneto or clear app data while recovery is pending.",
] as const;

export const RECOVERY_PENDING_MESSAGES = [
  `Your request has been sent to Oneto Support at ${SUPPORT_EMAIL_ADDRESS}.`,
  "You'll receive an email when your account is active on this device.",
  "Old payments already scanned by merchants may still sync during the 48-hour verification window.",
  "Do not uninstall Oneto or clear app data while waiting.",
] as const;

export const RECOVERY_REJECTED_MESSAGE =
  "We could not safely approve this request yet. If this was a stolen or compromised phone, support must review it manually before the old device can be trusted again.";

export function getDeviceLinkedActions(
  enableOldPhoneApproval: boolean,
): readonly DeviceLinkedAction[] {
  const actions: DeviceLinkedAction[] = [
    {
      label: "Request account recovery",
      pathname: "/(onboarding)/recovery-request",
    },
  ];

  if (enableOldPhoneApproval) {
    actions.push({
      label: "I still have my old phone",
      pathname: "/(onboarding)/move-device",
    });
  }

  return actions;
}
