import { tryNormalizeEmail } from "./email";

const FULL_ED25519_KEY_REGEX = /ed25519:[0-9a-f]{64,128}/gi;
const LONG_HEX_REGEX = /\b[0-9a-f]{64,}\b/gi;
const OTP_REGEX = /\b(?:otp|code)\b[\s:=-]*\d{4,8}\b/gi;
const PIN_REGEX = /\bpin\b[\s:=-]*\d{4,8}\b/gi;

export function redactSensitiveEmailText(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  return input
    .replace(FULL_ED25519_KEY_REGEX, "[redacted-key]")
    .replace(LONG_HEX_REGEX, "[redacted-hex]")
    .replace(OTP_REGEX, "[redacted-otp]")
    .replace(PIN_REGEX, "[redacted-pin]");
}

export function toKeySuffix(publicKey: string): string {
  return publicKey.slice(-8);
}

export function parseNotificationRecipients(configured: string | undefined): string[] {
  if (!configured) {
    return [];
  }

  const recipients = new Set<string>();
  for (const rawEmail of configured.split(",")) {
    const normalized = tryNormalizeEmail(rawEmail.trim());
    if (normalized) {
      recipients.add(normalized);
    }
  }

  return Array.from(recipients);
}
