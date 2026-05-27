import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  buildKeyRotationMessage,
  type PublicKeyString,
  type SignatureString,
  toPublicKeyString,
  toSignatureString,
} from "@oneto/shared";

// Rotation signatures use noble directly because they sign a raw
// domain-separated string, not canonical envelope JSON.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export function signRotation(
  newPublicKey: PublicKeyString,
  oldPrivateKey: Uint8Array,
): SignatureString {
  if (oldPrivateKey.length !== 32) {
    throw new Error("Old Ed25519 private key must be 32 bytes");
  }
  const message = buildKeyRotationMessage(newPublicKey);
  const messageBytes = new TextEncoder().encode(message);
  const sig = ed.sign(messageBytes, oldPrivateKey);
  return toSignatureString("ed25519:" + bytesToHex(sig));
}

export function derivePublicKeyFromPrivateKey(
  privateKey: Uint8Array,
): PublicKeyString {
  if (privateKey.length !== 32) {
    throw new Error("Ed25519 private key must be 32 bytes");
  }
  const publicKey = ed.getPublicKey(privateKey);
  return toPublicKeyString("ed25519:" + bytesToHex(publicKey));
}

export async function verifyRotationSignature(
  newPublicKey: PublicKeyString,
  oldPublicKey: PublicKeyString,
  rotationSignature: SignatureString,
): Promise<boolean> {
  try {
    const message = buildKeyRotationMessage(newPublicKey);
    const messageBytes = new TextEncoder().encode(message);
    const publicKeyBytes = hexToBytes(oldPublicKey.slice("ed25519:".length));
    const signatureBytes = hexToBytes(
      rotationSignature.slice("ed25519:".length),
    );
    return await ed.verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string has odd length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex string");
    }
    out[i] = byte;
  }
  return out;
}
