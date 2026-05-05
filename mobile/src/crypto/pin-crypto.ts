// PIN-derived symmetric encryption for the user's Ed25519 private key.
//
// Why scrypt and not Argon2id?
// - The pilot's mobile dependency landscape is friendlier to scrypt
//   (@noble/hashes/scrypt is pure JS, audited, already a transitive dep
//   via @oneto/shared). Adding Argon2 would mean either argon2-browser
//   (WASM, larger bundle) or a native module (eject from Expo managed).
// - Wallet ecosystem precedent: Ethereum keystore v3, Bitcoin BIP38,
//   and most mobile wallet libraries use scrypt for PIN/password-derived
//   keys for the same reasons.
// - Threat model: a 6-digit PIN has only ~20 bits of entropy. No KDF
//   makes brute-force impractical given a stolen blob; we rely instead
//   on the OS keystore (iOS Keychain / Android Keystore) preventing blob
//   extraction. scrypt at N=2^15 still raises the per-guess cost enough
//   that a phone-bound attacker takes ~28 hours per million guesses
//   (8.6 days for the full 10^6 PIN space) — long enough to detect a
//   missing phone and remote-wipe via lockout. Adequate for the pilot.
//
// Encryption is xchacha20poly1305 (authenticated): tampered ciphertexts
// fail loudly with an integrity error, which we surface as PinIncorrectError.
// The 24-byte nonce is regenerated on every encrypt; we never reuse a nonce
// with the same key.

import { scryptAsync } from "@noble/hashes/scrypt";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";

export const PIN_SALT_LENGTH = 16;
export const NONCE_LENGTH = 24;
export const DERIVED_KEY_LENGTH = 32;

// scrypt parameters. N=2^15 is the minimum recommended for interactive
// password use (NIST SP 800-132 / RFC 7914 guidance). Higher would make
// the "generate keys" screen feel slow on mid-range Android devices;
// lower would weaken offline brute force.
export const SCRYPT_N = 1 << 15; // 32768
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;

export interface EncryptedBlob {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
}

export class PinIncorrectError extends Error {
  constructor(message = "Incorrect PIN") {
    super(message);
    this.name = "PinIncorrectError";
  }
}

export function generateRandomBytes(length: number): Uint8Array {
  return randomBytes(length);
}

export async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (typeof pin !== "string" || pin.length === 0) {
    throw new Error("PIN must be a non-empty string");
  }
  if (salt.length !== PIN_SALT_LENGTH) {
    throw new Error(
      `salt must be ${PIN_SALT_LENGTH} bytes, got ${salt.length}`,
    );
  }
  const pinBytes = new TextEncoder().encode(pin);
  // scryptAsync periodically yields to the event loop so PIN entry/setup
  // doesn't freeze the UI for ~200ms on mid-range Android devices.
  return scryptAsync(pinBytes, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: DERIVED_KEY_LENGTH,
  });
}

export function encryptKeypair(
  privateKey: Uint8Array,
  derivedKey: Uint8Array,
): EncryptedBlob {
  if (derivedKey.length !== DERIVED_KEY_LENGTH) {
    throw new Error(
      `derivedKey must be ${DERIVED_KEY_LENGTH} bytes, got ${derivedKey.length}`,
    );
  }
  const nonce = generateRandomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(derivedKey, nonce);
  const ciphertext = cipher.encrypt(privateKey);
  return { ciphertext, nonce };
}

export function decryptKeypair(
  blob: EncryptedBlob,
  derivedKey: Uint8Array,
): Uint8Array {
  if (derivedKey.length !== DERIVED_KEY_LENGTH) {
    throw new Error(
      `derivedKey must be ${DERIVED_KEY_LENGTH} bytes, got ${derivedKey.length}`,
    );
  }
  if (blob.nonce.length !== NONCE_LENGTH) {
    throw new Error(
      `nonce must be ${NONCE_LENGTH} bytes, got ${blob.nonce.length}`,
    );
  }
  const cipher = xchacha20poly1305(derivedKey, blob.nonce);
  try {
    return cipher.decrypt(blob.ciphertext);
  } catch {
    // Either wrong PIN (different derived key) or tampered ciphertext.
    // We surface both as PinIncorrectError; the typed error keeps stack
    // traces and library internals out of any UI/log path.
    throw new PinIncorrectError();
  }
}
