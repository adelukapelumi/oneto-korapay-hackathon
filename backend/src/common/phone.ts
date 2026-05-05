import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Canonical phone number in E.164 format (e.g. "+2348012345678").
 * Branded to prevent accidental use of raw strings where E164 is expected.
 */
export type E164 = string & { readonly __brand: "E164" };

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Invalid phone number: ${input}`);
    this.name = "InvalidPhoneError";
  }
}

/**
 * Normalize any Nigerian phone number input to E.164 format.
 *
 * Accepts: "08012345678", "2348012345678", "+2348012345678", "0812 345 6789"
 * Returns: "+2348012345678"
 *
 * Throws InvalidPhoneError if the input is not a valid Nigerian mobile number.
 *
 * Default region is Nigeria ("NG"). Inputs with a different country code
 * are accepted if they parse as valid (e.g. future diaspora support).
 */
export function normalizePhone(input: string): E164 {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new InvalidPhoneError(input);
  }

  const parsed = parsePhoneNumberFromString(input.trim(), "NG");

  if (!parsed) {
    throw new InvalidPhoneError(input);
  }

  if (!parsed.isValid()) {
    throw new InvalidPhoneError(input);
  }

  // Reject landlines and non-mobile lines for the pilot.
  // "The phone field is used only for merchant contact and optional 2FA; SMS is not the primary OTP channel
  if (parsed.getType() && parsed.getType() !== "MOBILE" && parsed.getType() !== "FIXED_LINE_OR_MOBILE") {
    throw new InvalidPhoneError(input);
  }

  return parsed.number as unknown as E164;
}

/**
 * Non-throwing variant. Returns null if the phone is invalid.
 * Use this at API boundaries where you want to return a 400 instead of crashing.
 */
export function tryNormalizePhone(input: string): E164 | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}