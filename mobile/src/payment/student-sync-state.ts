export const STUDENT_OUTGOING_AUTO_SYNC_COOLDOWN_MS = 15_000;

export type StudentOutgoingSyncStatusKind =
  | "idle"
  | "offline"
  | "syncing"
  | "waiting_for_merchant"
  | "updated"
  | "retry_later";

export interface StudentOutgoingSyncStatus {
  readonly kind: StudentOutgoingSyncStatusKind;
  readonly message: string | null;
}

export function shouldRequestStudentOutgoingAutoSync(input: {
  readonly isStudent: boolean;
  readonly isOnline: boolean;
  readonly jwtFresh: boolean;
  readonly pendingOutgoingCount: number;
  readonly isSyncInFlight: boolean;
  readonly lastSyncAttemptAtMs: number;
  readonly nowMs: number;
  readonly cooldownMs?: number;
}): boolean {
  if (!Number.isInteger(input.pendingOutgoingCount) || input.pendingOutgoingCount < 0) {
    throw new Error("pendingOutgoingCount must be a non-negative integer");
  }
  if (!Number.isFinite(input.lastSyncAttemptAtMs) || input.lastSyncAttemptAtMs < 0) {
    throw new Error("lastSyncAttemptAtMs must be a non-negative timestamp");
  }
  if (!Number.isFinite(input.nowMs) || input.nowMs < 0) {
    throw new Error("nowMs must be a non-negative timestamp");
  }

  const cooldownMs = input.cooldownMs ?? STUDENT_OUTGOING_AUTO_SYNC_COOLDOWN_MS;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error("cooldownMs must be a non-negative duration");
  }

  if (!input.isStudent || !input.isOnline || !input.jwtFresh) {
    return false;
  }
  if (input.pendingOutgoingCount === 0 || input.isSyncInFlight) {
    return false;
  }
  if (input.lastSyncAttemptAtMs > 0 && input.nowMs - input.lastSyncAttemptAtMs < cooldownMs) {
    return false;
  }

  return true;
}

export function getStudentOutgoingSyncStatus(input: {
  readonly pendingOutgoingCount: number;
  readonly isOnline: boolean;
  readonly isSyncing: boolean;
  readonly markedTerminal: number;
  readonly hasNetworkError: boolean;
  readonly checkedAtMs: number | null;
}): StudentOutgoingSyncStatus {
  if (!Number.isInteger(input.pendingOutgoingCount) || input.pendingOutgoingCount < 0) {
    throw new Error("pendingOutgoingCount must be a non-negative integer");
  }
  if (!Number.isInteger(input.markedTerminal) || input.markedTerminal < 0) {
    throw new Error("markedTerminal must be a non-negative integer");
  }

  if (input.pendingOutgoingCount === 0 && input.markedTerminal === 0) {
    return { kind: "idle", message: null };
  }

  if (input.isSyncing) {
    return {
      kind: "syncing",
      message: "Syncing pending payments...",
    };
  }

  if (!input.isOnline || input.hasNetworkError) {
    return {
      kind: "retry_later",
      message: "Could not check status. Will retry when online.",
    };
  }

  if (input.markedTerminal > 0) {
    return {
      kind: "updated",
      message: "Payment status updated. Balance refreshed.",
    };
  }

  return {
    kind: "waiting_for_merchant",
    message: input.checkedAtMs === null
      ? "Waiting for merchant to sync."
      : "Waiting for merchant to sync. Last checked just now.",
  };
}
