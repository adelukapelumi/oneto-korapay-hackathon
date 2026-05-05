// PIN-attempt UI helpers.
//
// The keypair-store owns the persisted attempt counter and the canonical
// lockout policy. This module is a place for the UI's
// presentation-layer concerns: formatting countdowns, deciding what
// message to show, etc. Kept separate from keypair-store so the storage
// module stays free of UI/string concerns.

import {
  ATTEMPTS_BEFORE_LOCKOUT,
  ATTEMPTS_BEFORE_WIPE,
  type AttemptState,
} from "../crypto/pin-derive";

export interface AttemptDisplay {
  /** Human-readable reason (or null if everything is fine). */
  readonly message: string | null;
  /** Seconds until unlock (rounded up). 0 when not locked. */
  readonly lockSecondsRemaining: number;
  /** True if the next wrong attempt will wipe the keypair. */
  readonly wipeOnNextWrong: boolean;
}

export function describeAttemptState(
  state: AttemptState,
  nowMs: number = Date.now(),
): AttemptDisplay {
  const wipeOnNextWrong = state.wrongAttempts >= ATTEMPTS_BEFORE_WIPE - 1;
  if (state.isLocked && state.lockedUntilMs !== null) {
    const remaining = Math.max(
      0,
      Math.ceil((state.lockedUntilMs - nowMs) / 1000),
    );
    return {
      message: `Locked. Try again in ${formatMmSs(remaining)}.`,
      lockSecondsRemaining: remaining,
      wipeOnNextWrong,
    };
  }
  if (state.wrongAttempts === 0) {
    return { message: null, lockSecondsRemaining: 0, wipeOnNextWrong };
  }
  const remainingBeforeLock =
    ATTEMPTS_BEFORE_LOCKOUT -
    (state.wrongAttempts % ATTEMPTS_BEFORE_LOCKOUT || ATTEMPTS_BEFORE_LOCKOUT);
  const safeRemaining = remainingBeforeLock < 0 ? 0 : remainingBeforeLock;
  return {
    message: `Incorrect PIN. ${safeRemaining} attempts remaining before lockout.`,
    lockSecondsRemaining: 0,
    wipeOnNextWrong,
  };
}

export function formatMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
