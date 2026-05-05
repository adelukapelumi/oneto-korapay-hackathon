import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import type { AxiosInstance } from "axios";
import {
  type PublicKeyString,
  type SignatureString,
  toSignatureString,
} from "@oneto/shared";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

// @oneto/shared exposes signEnvelope (canonical-JSON envelope signing)
// but NOT a raw-bytes signer. The rotation signature the backend
// expects is `ed.sign(utf8Bytes(newPublicKeyString), oldPrivateKey)` —
// a different shape from envelope signing — so we go through the same
// vetted library shared uses (@noble/ed25519) rather than reimplement.
// This is consistent with CLAUDE.md §7.1 ("never roll your own crypto"):
// we are NOT implementing Ed25519, only invoking it.
//
// The SHA-512 sync shim must be installed before any sign/verify call.
// shared sets it on import too; this is idempotent.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * Thrown when the backend says we need to provide a rotation signature
 * (i.e. the server already has a registered key for this user). The UI
 * uses this to route to the lost-key recovery screen.
 */
export class RotationSignatureRequiredError extends Error {
  constructor() {
    super("rotation_signature_required");
    this.name = "RotationSignatureRequiredError";
  }
}

/**
 * Sign a new public key string with the OLD private key, producing the
 * "rotation signature" the backend expects on key rotation.
 *
 * Important: the message is the RAW public key STRING (e.g.
 * "ed25519:abc..."), encoded as UTF-8 bytes. Not canonical JSON.
 * This matches backend/src/auth/keys.controller.ts which does
 * `new TextEncoder().encode(newPublicKey)` before verification.
 *
 * Do NOT use signEnvelope from @oneto/shared here — that produces a
 * canonical-JSON signature meant for transaction envelopes, a different
 * shape than what /auth/keys/register expects.
 */
export function signRotation(
  newPublicKey: PublicKeyString,
  oldPrivateKey: Uint8Array,
): SignatureString {
  if (oldPrivateKey.length !== 32) {
    throw new Error("Old Ed25519 private key must be 32 bytes");
  }
  const messageBytes = new TextEncoder().encode(newPublicKey);
  const sig = ed.sign(messageBytes, oldPrivateKey);
  return toSignatureString("ed25519:" + bytesToHex(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

interface RegisterKeyResponse {
  readonly success: true;
}

/**
 * POST /auth/keys/register.
 *
 * - First registration: omit rotationSignature.
 * - Rotation: include a rotationSignature signed by the OLD private key.
 *
 * The backend returns 400 with body `{message: "rotation_signature_required"}`
 * when the user already has a registered key but the request omitted the
 * signature. We translate that into RotationSignatureRequiredError so the
 * UI can route to lost-key support.
 */
export async function registerPublicKey(
  publicKey: PublicKeyString,
  rotationSignature?: SignatureString,
  client: AxiosInstance = apiClient,
): Promise<RegisterKeyResponse> {
  try {
    const body = rotationSignature
      ? { publicKey, rotationSignature }
      : { publicKey };
    await client.post<unknown>("/auth/keys/register", body);
    return { success: true };
  } catch (err) {
    const typed = err instanceof ApiError ? err : toTypedError(err);
    if (
      typed instanceof ApiError &&
      typed.status === 400 &&
      typed.message === "rotation_signature_required"
    ) {
      throw new RotationSignatureRequiredError();
    }
    throw typed;
  }
}
