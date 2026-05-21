import * as crypto from "crypto";
import { type UserId, toUserId } from "@oneto/shared";

/**
 * Generate the canonical oneto user ID used by payment envelopes.
 *
 * Format: "u_" + 16 lowercase hex chars (8 random bytes).
 * We validate the generated string with the shared branded helper so the
 * backend and envelope schema stay locked to the same format.
 */
export function generateOnetoUserId(): UserId {
  const candidate = `u_${crypto.randomBytes(8).toString("hex")}`;
  return toUserId(candidate);
}
