/**
 * Canonical JSON serialization.
 *
 * Both the signer (mobile) and verifier (backend) MUST produce identical
 * bytes for the same logical object. Any drift means signatures never verify.
 *
 * Rules:
 *   - Keys sorted alphabetically at every nesting level
 *   - No whitespace
 *   - UTF-8 encoding
 *   - No trailing commas, no comments
 *   - Objects with extra keys are rejected (use zod schema first)
 *
 * This function is deliberately minimal and dependency-free so it behaves
 * identically across Node and React Native runtimes.
 */

export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";

  if (typeof v === "boolean") return v ? "true" : "false";

  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error("Cannot canonicalize non-finite number");
    }
    // Integers serialize plainly. Floats are explicitly unsupported here
    // because we never canonicalize monetary values as floats.
    if (!Number.isInteger(v)) {
      throw new Error("Cannot canonicalize non-integer number (use kobo)");
    }
    return v.toString();
  }

  if (typeof v === "string") {
    return JSON.stringify(v); // handles escaping per JSON spec
  }

  if (Array.isArray(v)) {
    return "[" + v.map(serialize).join(",") + "]";
  }

  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ":" + serialize(obj[k]));
    return "{" + pairs.join(",") + "}";
  }

  throw new Error(`Cannot canonicalize value of type ${typeof v}`);
}

/**
 * Canonicalize and UTF-8 encode. This is what gets hashed and signed.
 */
export function canonicalizeToBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}