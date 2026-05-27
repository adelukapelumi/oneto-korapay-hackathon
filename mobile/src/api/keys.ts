import type { AxiosInstance } from "axios";
import type { PublicKeyString, SignatureString } from "@oneto/shared";
import { apiClient } from "./client";
import { ApiError, toTypedError } from "./errors";

export {
  derivePublicKeyFromPrivateKey,
  signRotation,
  verifyRotationSignature,
} from "../keys/rotation-signature";

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
