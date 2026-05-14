import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  PublicKeyString,
  toPublicKeyString,
} from "../types/branded";

// @noble/ed25519 v2 requires this shim so it can compute SHA-512
// synchronously where needed. One-time setup.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * Generate a fresh Ed25519 keypair.
 *
 * The private key returned here is 32 raw bytes. NEVER persist this
 * in plain storage on any device. On mobile it MUST go into
 * expo-secure-store (which uses iOS Keychain / Android Keystore).
 */
export function generateKeypair(): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyString: PublicKeyString;
} {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyString: toPublicKeyString("ed25519:" + toHex(publicKey)),
  };
}

export function publicKeyFromString(s: PublicKeyString): Uint8Array {
  const hex = s.slice("ed25519:".length);
  return fromHex(hex);
}

export function publicKeyToString(bytes: Uint8Array): PublicKeyString {
  if (bytes.length !== 32) {
    throw new Error(`Public key must be 32 bytes, got ${bytes.length}`);
  }
  return toPublicKeyString("ed25519:" + toHex(bytes));
}


export const KEY_ROTATION_DOMAIN = "oneto:key-rotation:v1:";

export function buildKeyRotationMessage(newPublicKey: string): string {
  return `${KEY_ROTATION_DOMAIN}${newPublicKey}`;
}

// ---------- hex utilities (small, self-contained) ----------

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    s += byte.toString(16).padStart(2, "0");
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string has odd length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}