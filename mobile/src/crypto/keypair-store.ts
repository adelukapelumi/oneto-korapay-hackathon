// Wraps expo-secure-store for the user's keypair material:
//   - oneto.keypair.salt        16 random bytes for scrypt
//   - oneto.keypair.blob        encrypted private key + xchacha20 nonce
//   - oneto.keypair.publicKey   public key string (plain, but in secure-store
//                               for atomicity with the encrypted blob)
//   - oneto.keypair.attempts    JSON { wrongAttempts, lockedUntilMs }
//
// The store fails LOUDLY on read errors. A SecureStore.getItemAsync that
// throws is NOT silently coerced into "no keypair" — the caller has to
// decide. That prevents a corrupted keychain entry from looking like a
// fresh install and silently triggering a re-onboarding flow.
//
// Bytes are persisted as base64 strings because expo-secure-store stores
// strings only.

import * as SecureStore from "expo-secure-store";
import {
  EncryptedBlob,
  NONCE_LENGTH,
  PIN_SALT_LENGTH,
  PinIncorrectError,
  decryptKeypair,
  deriveKeyFromPin,
  encryptKeypair,
  generateRandomBytes,
} from "./pin-crypto";

interface SlotKeys {
  readonly saltKey: string;
  readonly blobKey: string;
  readonly publicKeyKey: string;
  readonly attemptsKey: string;
}

const ACTIVE_SLOT: SlotKeys = {
  saltKey: "oneto.keypair.salt",
  blobKey: "oneto.keypair.blob",
  publicKeyKey: "oneto.keypair.publicKey",
  attemptsKey: "oneto.keypair.attempts",
};

const PENDING_RECOVERY_SLOT: SlotKeys = {
  saltKey: "oneto.keypair.pending.salt",
  blobKey: "oneto.keypair.pending.blob",
  publicKeyKey: "oneto.keypair.pending.publicKey",
  attemptsKey: "oneto.keypair.pending.attempts",
};

// Lockout policy:
//   5 wrong attempts → lock for 5 minutes
//   After lock expires, 5 more attempts allowed
//   10 wrong attempts total → wipe keypair
export const ATTEMPTS_BEFORE_LOCKOUT = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
export const ATTEMPTS_BEFORE_WIPE = 10;

export class PinLockedError extends Error {
  public readonly lockedUntilMs: number;
  constructor(lockedUntilMs: number) {
    super("PIN entry is locked");
    this.name = "PinLockedError";
    this.lockedUntilMs = lockedUntilMs;
  }
}

export class KeypairWipedError extends Error {
  constructor() {
    super("Keypair has been wiped after too many failed attempts");
    this.name = "KeypairWipedError";
  }
}

export interface AttemptState {
  readonly wrongAttempts: number;
  readonly lockedUntilMs: number | null;
  readonly isLocked: boolean;
}

interface StoredAttempts {
  readonly wrongAttempts: number;
  readonly lockedUntilMs: number | null;
}

function toBase64(bytes: Uint8Array): string {
  // React Native ships a global Buffer-less environment; fall back through
  // both options. globalThis.btoa exists in RN 0.74+ and Hermes.
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
  }
  // Node test environment.
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

interface StoredBlob {
  readonly ciphertext: string;
  readonly nonce: string;
}

function serializeBlob(blob: EncryptedBlob): string {
  const obj: StoredBlob = {
    ciphertext: toBase64(blob.ciphertext),
    nonce: toBase64(blob.nonce),
  };
  return JSON.stringify(obj);
}

function parseBlob(raw: string): EncryptedBlob {
  const obj = JSON.parse(raw) as unknown;
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof (obj as StoredBlob).ciphertext !== "string" ||
    typeof (obj as StoredBlob).nonce !== "string"
  ) {
    throw new Error("Stored keypair blob is malformed");
  }
  const stored = obj as StoredBlob;
  const nonce = fromBase64(stored.nonce);
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error("Stored nonce has wrong length");
  }
  return { ciphertext: fromBase64(stored.ciphertext), nonce };
}

export async function hasKeypair(): Promise<boolean> {
  return hasKeypairInSlot(ACTIVE_SLOT);
}

export async function hasPendingRecoveryKeypair(): Promise<boolean> {
  return hasKeypairInSlot(PENDING_RECOVERY_SLOT);
}

async function hasKeypairInSlot(slot: SlotKeys): Promise<boolean> {
  const [salt, blob, pub] = await Promise.all([
    SecureStore.getItemAsync(slot.saltKey),
    SecureStore.getItemAsync(slot.blobKey),
    SecureStore.getItemAsync(slot.publicKeyKey),
  ]);
  return salt !== null && blob !== null && pub !== null;
}

export async function saveNewKeypair(
  privateKey: Uint8Array,
  publicKey: string,
  pin: string,
): Promise<void> {
  await saveKeypairToSlot(ACTIVE_SLOT, privateKey, publicKey, pin);
}

export async function savePendingRecoveryKeypair(
  privateKey: Uint8Array,
  publicKey: string,
  pin: string,
): Promise<void> {
  await saveKeypairToSlot(PENDING_RECOVERY_SLOT, privateKey, publicKey, pin);
}

async function saveKeypairToSlot(
  slot: SlotKeys,
  privateKey: Uint8Array,
  publicKey: string,
  pin: string,
): Promise<void> {
  if (privateKey.length !== 32) {
    throw new Error("Ed25519 private key must be 32 bytes");
  }
  const salt = generateRandomBytes(PIN_SALT_LENGTH);
  const derivedKey = await deriveKeyFromPin(pin, salt);
  const blob = encryptKeypair(privateKey, derivedKey);
  // Order: write salt + blob + pubkey before clearing any old attempts.
  // If we crash mid-write, hasKeypair() returns false and we re-onboard,
  // which is the safe direction.
  await SecureStore.setItemAsync(slot.saltKey, toBase64(salt));
  await SecureStore.setItemAsync(slot.blobKey, serializeBlob(blob));
  await SecureStore.setItemAsync(slot.publicKeyKey, publicKey);
  await SecureStore.deleteItemAsync(slot.attemptsKey);
}

export async function loadAndDecryptKeypair(
  pin: string,
): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  return loadAndDecryptKeypairFromSlot(ACTIVE_SLOT, pin);
}

export async function loadAndDecryptPendingRecoveryKeypair(
  pin: string,
): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  return loadAndDecryptKeypairFromSlot(PENDING_RECOVERY_SLOT, pin);
}

async function loadAndDecryptKeypairFromSlot(
  slot: SlotKeys,
  pin: string,
): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  const state = await getAttemptStateForSlot(slot);
  if (state.isLocked) {
    throw new PinLockedError(state.lockedUntilMs ?? Date.now());
  }

  const [saltRaw, blobRaw, pub] = await Promise.all([
    SecureStore.getItemAsync(slot.saltKey),
    SecureStore.getItemAsync(slot.blobKey),
    SecureStore.getItemAsync(slot.publicKeyKey),
  ]);
  if (saltRaw === null || blobRaw === null || pub === null) {
    throw new Error("No keypair stored on this device");
  }
  const salt = fromBase64(saltRaw);
  if (salt.length !== PIN_SALT_LENGTH) {
    throw new Error("Stored salt has wrong length");
  }
  const blob = parseBlob(blobRaw);
  const derivedKey = await deriveKeyFromPin(pin, salt);
  // decryptKeypair throws PinIncorrectError on auth tag mismatch — propagate.
  const privateKey = decryptKeypair(blob, derivedKey);
  return { privateKey, publicKey: pub };
}

export async function changePinAndReencrypt(
  oldPin: string,
  newPin: string,
): Promise<void> {
  // Decrypt with old PIN. If wrong, this throws PinIncorrectError and
  // the existing blob is untouched.
  const { privateKey, publicKey } = await loadAndDecryptKeypair(oldPin);
  // Re-derive a fresh salt + blob from the new PIN. This effectively
  // resets the PIN-attack difficulty (new salt, new derived key).
  await saveNewKeypair(privateKey, publicKey, newPin);
}

export async function wipeKeypair(): Promise<void> {
  await wipeSlot(ACTIVE_SLOT);
}

export async function wipePendingRecoveryKeypair(): Promise<void> {
  await wipeSlot(PENDING_RECOVERY_SLOT);
}

async function wipeSlot(slot: SlotKeys): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(slot.saltKey),
    SecureStore.deleteItemAsync(slot.blobKey),
    SecureStore.deleteItemAsync(slot.publicKeyKey),
    SecureStore.deleteItemAsync(slot.attemptsKey),
  ]);
}

export async function getStoredPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_SLOT.publicKeyKey);
}

export async function getPendingRecoveryPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PENDING_RECOVERY_SLOT.publicKeyKey);
}

export async function moveKeypairToPendingRecovery(): Promise<void> {
  await copySlot(ACTIVE_SLOT, PENDING_RECOVERY_SLOT);
  await wipeSlot(ACTIVE_SLOT);
}

export async function promotePendingRecoveryKeypair(): Promise<void> {
  await copySlot(PENDING_RECOVERY_SLOT, ACTIVE_SLOT);
  await wipeSlot(PENDING_RECOVERY_SLOT);
}

async function copySlot(from: SlotKeys, to: SlotKeys): Promise<void> {
  const [salt, blob, publicKey, attempts] = await Promise.all([
    SecureStore.getItemAsync(from.saltKey),
    SecureStore.getItemAsync(from.blobKey),
    SecureStore.getItemAsync(from.publicKeyKey),
    SecureStore.getItemAsync(from.attemptsKey),
  ]);

  if (salt === null || blob === null || publicKey === null) {
    throw new Error("No keypair stored in source slot");
  }

  await SecureStore.setItemAsync(to.saltKey, salt);
  await SecureStore.setItemAsync(to.blobKey, blob);
  await SecureStore.setItemAsync(to.publicKeyKey, publicKey);
  if (attempts === null) {
    await SecureStore.deleteItemAsync(to.attemptsKey);
  } else {
    await SecureStore.setItemAsync(to.attemptsKey, attempts);
  }
}

async function readAttempts(slot: SlotKeys): Promise<StoredAttempts> {
  const raw = await SecureStore.getItemAsync(slot.attemptsKey);
  if (raw === null) {
    return { wrongAttempts: 0, lockedUntilMs: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredAttempts).wrongAttempts === "number" &&
      ((parsed as StoredAttempts).lockedUntilMs === null ||
        typeof (parsed as StoredAttempts).lockedUntilMs === "number")
    ) {
      return parsed as StoredAttempts;
    }
  } catch {
    // Fall through. A malformed attempts record is treated as fresh state;
    // the worst case is the user gets a few extra retries.
  }
  return { wrongAttempts: 0, lockedUntilMs: null };
}

async function writeAttempts(slot: SlotKeys, s: StoredAttempts): Promise<void> {
  await SecureStore.setItemAsync(slot.attemptsKey, JSON.stringify(s));
}

export async function getAttemptState(
  nowMs: number = Date.now(),
): Promise<AttemptState> {
  return getAttemptStateForSlot(ACTIVE_SLOT, nowMs);
}

export async function getPendingRecoveryAttemptState(
  nowMs: number = Date.now(),
): Promise<AttemptState> {
  return getAttemptStateForSlot(PENDING_RECOVERY_SLOT, nowMs);
}

async function getAttemptStateForSlot(
  slot: SlotKeys,
  nowMs: number = Date.now(),
): Promise<AttemptState> {
  const stored = await readAttempts(slot);
  let lockedUntilMs = stored.lockedUntilMs;
  if (lockedUntilMs !== null && lockedUntilMs <= nowMs) {
    // Lock expired — surface as unlocked. We DON'T mutate the stored
    // attempt count here; the wrongAttempts counter must persist across
    // the lockout so we can wipe at 10 total.
    lockedUntilMs = null;
  }
  return {
    wrongAttempts: stored.wrongAttempts,
    lockedUntilMs,
    isLocked: lockedUntilMs !== null,
  };
}

export interface RecordResult {
  readonly remainingBeforeLock: number;
  readonly willWipe: boolean;
  readonly nowLocked: boolean;
  readonly lockedUntilMs: number | null;
}

export async function recordWrongAttempt(
  nowMs: number = Date.now(),
): Promise<RecordResult> {
  return recordWrongAttemptForSlot(ACTIVE_SLOT, nowMs);
}

export async function recordPendingRecoveryWrongAttempt(
  nowMs: number = Date.now(),
): Promise<RecordResult> {
  return recordWrongAttemptForSlot(PENDING_RECOVERY_SLOT, nowMs);
}

async function recordWrongAttemptForSlot(
  slot: SlotKeys,
  nowMs: number = Date.now(),
): Promise<RecordResult> {
  const stored = await readAttempts(slot);
  const wrongAttempts = stored.wrongAttempts + 1;

  if (wrongAttempts >= ATTEMPTS_BEFORE_WIPE) {
    // Hard cap reached. Wipe and surface willWipe so the UI can route.
    await wipeSlot(slot);
    return {
      remainingBeforeLock: 0,
      willWipe: true,
      nowLocked: false,
      lockedUntilMs: null,
    };
  }

  // Lock if we just hit a multiple of ATTEMPTS_BEFORE_LOCKOUT.
  // 5 wrong → lock; 6-9 wrong (after unlock) → no new lock until 10.
  const justHitLockoutBoundary =
    wrongAttempts > 0 && wrongAttempts % ATTEMPTS_BEFORE_LOCKOUT === 0;
  const lockedUntilMs = justHitLockoutBoundary
    ? nowMs + LOCKOUT_DURATION_MS
    : null;

  await writeAttempts(slot, { wrongAttempts, lockedUntilMs });

  const remainingBeforeLock = justHitLockoutBoundary
    ? 0
    : ATTEMPTS_BEFORE_LOCKOUT -
      (wrongAttempts % ATTEMPTS_BEFORE_LOCKOUT || ATTEMPTS_BEFORE_LOCKOUT);

  return {
    remainingBeforeLock,
    willWipe: false,
    nowLocked: justHitLockoutBoundary,
    lockedUntilMs,
  };
}

export async function clearAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_SLOT.attemptsKey);
}

export async function clearPendingRecoveryAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_RECOVERY_SLOT.attemptsKey);
}

// Re-export errors so callers don't have to import from pin-crypto separately.
export { PinIncorrectError };
