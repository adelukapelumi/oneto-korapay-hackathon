// Thin facade for PIN orchestration.
//
// The brief carves PIN handling into three modules:
//   pin-crypto       — pure crypto primitives (scrypt + xchacha20poly1305)
//   keypair-store    — persistence (expo-secure-store) + lockout policy
//   pin-derive       — what the UI calls; combines the two
//
// Today this module is a re-export. We keep it as a separate boundary so a
// future change (e.g. moving to hardware-backed keys, or splitting the salt
// out of secure-store) only has to touch one file the UI imports from.

export {
  saveNewKeypair as saveKeypairUnderPin,
  savePendingRecoveryKeypair,
  loadAndDecryptKeypair as unlockKeypairWithPin,
  loadAndDecryptPendingRecoveryKeypair,
  changePinAndReencrypt,
  hasKeypair,
  hasPendingRecoveryKeypair,
  wipeKeypair,
  wipePendingRecoveryKeypair,
  moveKeypairToPendingRecovery,
  promotePendingRecoveryKeypair,
  getStoredPublicKey,
  getPendingRecoveryPublicKey,
  recordWrongAttempt,
  recordPendingRecoveryWrongAttempt,
  clearAttempts,
  clearPendingRecoveryAttempts,
  getAttemptState,
  getPendingRecoveryAttemptState,
  PinIncorrectError,
  PinLockedError,
  KeypairWipedError,
  ATTEMPTS_BEFORE_LOCKOUT,
  ATTEMPTS_BEFORE_WIPE,
  LOCKOUT_DURATION_MS,
} from "./keypair-store";

export type { AttemptState, RecordResult } from "./keypair-store";
