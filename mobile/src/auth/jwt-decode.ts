// Client-side JWT payload reader.
//
// We intentionally do NOT verify the signature here. Verification is a
// server-side concern; the backend already does it on every request. The
// mobile app only needs to peek at the payload to decide:
//   - is this token still fresh enough to make online calls? (`exp`)
//   - has the user already registered a public key on the backend?
//     (`pubKeyRegistered`)
//
// Treat the payload as untrusted: the jti, sub, role, etc. are advisory.
// The server is the source of truth.

export interface DecodedJwt {
  readonly sub: string;
  readonly email: string;
  readonly role: "STUDENT" | "MERCHANT" | "ADMIN";
  readonly pubKeyRegistered: boolean;
  readonly exp: number; // unix seconds
  readonly iat: number; // unix seconds
}

const SKEW_TOLERANCE_SECONDS = 30;

function base64UrlToString(input: string): string | null {
  try {
    // Convert base64url to base64.
    const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
    const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") {
      return atob(b64);
    }
    return Buffer.from(b64, "base64").toString("binary");
  } catch {
    return null;
  }
}

function isDecodedJwt(value: unknown): value is DecodedJwt {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof DecodedJwt, unknown>>;
  return (
    typeof v.sub === "string" &&
    typeof v.email === "string" &&
    (v.role === "STUDENT" || v.role === "MERCHANT" || v.role === "ADMIN") &&
    typeof v.pubKeyRegistered === "boolean" &&
    typeof v.exp === "number" &&
    typeof v.iat === "number"
  );
}

export function decodeJwt(token: string): DecodedJwt | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadStr = base64UrlToString(parts[1]!);
  if (payloadStr === null) return null;
  // Some environments need utf-8 reinterpretation of the binary string.
  let parsed: unknown;
  try {
    // atob returns a binary string; if the JWT was UTF-8 it might contain
    // multi-byte chars. Reconstruct as UTF-8 before JSON.parse.
    let utf8 = payloadStr;
    try {
      const bytes = new Uint8Array(payloadStr.length);
      for (let i = 0; i < payloadStr.length; i++) {
        bytes[i] = payloadStr.charCodeAt(i) & 0xff;
      }
      utf8 = new TextDecoder().decode(bytes);
    } catch {
      // Fall back to the raw decoded string.
    }
    parsed = JSON.parse(utf8);
  } catch {
    return null;
  }
  if (!isDecodedJwt(parsed)) return null;
  return parsed;
}

export function isJwtExpired(
  token: string,
  nowMs: number = Date.now(),
): boolean {
  const decoded = decodeJwt(token);
  if (decoded === null) return true;
  const nowSeconds = Math.floor(nowMs / 1000);
  // Treat as expired SKEW_TOLERANCE_SECONDS before exp so we don't fire
  // a request that the backend will reject moments later.
  return decoded.exp - SKEW_TOLERANCE_SECONDS <= nowSeconds;
}
