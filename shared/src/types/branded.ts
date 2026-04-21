/**
 * Branded types prevent accidental mixing of different string IDs
 * and different numeric values that shouldn't be interchangeable.
 *
 * Example: a function expecting Kobo will reject a raw number.
 * Example: a function expecting UserId will reject a raw string.
 */

// ---------- Kobo (integer, never float) ----------

export type Kobo = number & { readonly __brand: "Kobo" };

export function toKobo(n: number): Kobo {
  if (!Number.isFinite(n)) {
    throw new Error(`Kobo must be a finite number, got: ${n}`);
  }
  if (!Number.isInteger(n)) {
    throw new Error(`Kobo must be an integer, got: ${n}`);
  }
  if (n < 0) {
    throw new Error(`Kobo cannot be negative, got: ${n}`);
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Kobo exceeds MAX_SAFE_INTEGER, got: ${n}`);
  }
  return n as Kobo;
}

// ---------- UserId ----------

export type UserId = string & { readonly __brand: "UserId" };

const USER_ID_REGEX = /^u_[0-9a-f]{16}$/;

export function toUserId(s: string): UserId {
  if (!USER_ID_REGEX.test(s)) {
    throw new Error(`Invalid UserId format: ${s}`);
  }
  return s as UserId;
}

export function isUserId(s: unknown): s is UserId {
  return typeof s === "string" && USER_ID_REGEX.test(s);
}

// ---------- TransactionId ----------

export type TransactionId = string & { readonly __brand: "TransactionId" };

const TX_ID_REGEX = /^tx_[0-9a-f]{16}$/;

export function toTransactionId(s: string): TransactionId {
  if (!TX_ID_REGEX.test(s)) {
    throw new Error(`Invalid TransactionId format: ${s}`);
  }
  return s as TransactionId;
}

// ---------- Nonce ----------

export type Nonce = string & { readonly __brand: "Nonce" };

// 32 hex chars = 128 bits of entropy, plenty for request nonces
const NONCE_REGEX = /^[0-9a-f]{32}$/;

export function toNonce(s: string): Nonce {
  if (!NONCE_REGEX.test(s)) {
    throw new Error(`Invalid Nonce format: ${s}`);
  }
  return s as Nonce;
}

// ---------- Key material (as strings for transport/storage) ----------

// Format: "ed25519:" + 64 hex chars (32 bytes)
export type PublicKeyString = string & { readonly __brand: "PublicKeyString" };

// Format: "ed25519:" + 128 hex chars (64 bytes signature)
export type SignatureString = string & { readonly __brand: "SignatureString" };

const PUB_KEY_REGEX = /^ed25519:[0-9a-f]{64}$/;
const SIG_REGEX = /^ed25519:[0-9a-f]{128}$/;

export function toPublicKeyString(s: string): PublicKeyString {
  if (!PUB_KEY_REGEX.test(s)) {
    throw new Error(`Invalid PublicKeyString format`);
  }
  return s as PublicKeyString;
}

export function toSignatureString(s: string): SignatureString {
  if (!SIG_REGEX.test(s)) {
    throw new Error(`Invalid SignatureString format`);
  }
  return s as SignatureString;
}