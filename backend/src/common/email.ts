import { z } from "zod";

/**
 * Canonical email address.
 * Branded to prevent accidental use of raw strings where NormalizedEmail is expected.
 */
export type NormalizedEmail = string & { readonly __brand: "NormalizedEmail" };

export class InvalidEmailError extends Error {
  constructor(input: string) {
    super(`Invalid email address: ${input}`);
    this.name = "InvalidEmailError";
  }
}

const emailSchema = z.string().email();

/**
 * Normalize an email input (lowercase + trim) and validate format.
 *
 * Throws InvalidEmailError if the input is not a valid email address.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new InvalidEmailError(input);
  }

  const normalized = input.toLowerCase().trim();

  const result = emailSchema.safeParse(normalized);
  if (!result.success) {
    throw new InvalidEmailError(input);
  }

  return normalized as NormalizedEmail;
}

/**
 * Non-throwing variant. Returns null if the email is invalid.
 * Use this at API boundaries where you want to return a 400 instead of crashing.
 */
export function tryNormalizeEmail(input: string): NormalizedEmail | null {
  try {
    return normalizeEmail(input);
  } catch {
    return null;
  }
}
