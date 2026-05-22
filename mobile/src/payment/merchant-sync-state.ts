export const MERCHANT_AUTO_SYNC_COOLDOWN_MS = 15_000;

export interface MerchantSyncButtonState {
  readonly label: string;
  readonly disabled: boolean;
  readonly showLoading: boolean;
}

export function getMerchantSyncButtonState(input: {
  readonly isOnline: boolean;
  readonly isSyncing: boolean;
  readonly jwtFresh: boolean;
  readonly pendingIncomingCount: number;
}): MerchantSyncButtonState {
  if (!Number.isInteger(input.pendingIncomingCount) || input.pendingIncomingCount < 0) {
    throw new Error("pendingIncomingCount must be a non-negative integer");
  }

  if (!input.isOnline) {
    return {
      label: "Connect to sync",
      disabled: true,
      showLoading: false,
    };
  }

  if (!input.jwtFresh) {
    return {
      label: "Sign in to sync",
      disabled: true,
      showLoading: false,
    };
  }

  if (input.isSyncing) {
    return {
      label: "Syncing...",
      disabled: true,
      showLoading: true,
    };
  }

  if (input.pendingIncomingCount === 0) {
    return {
      label: "All synced",
      disabled: true,
      showLoading: false,
    };
  }

  return {
    label: "Sync Now",
    disabled: false,
    showLoading: false,
  };
}

export function shouldRequestMerchantAutoSync(input: {
  readonly isMerchant: boolean;
  readonly isOnline: boolean;
  readonly jwtFresh: boolean;
  readonly pendingIncomingCount: number;
  readonly isSyncInFlight: boolean;
  readonly lastSyncAttemptAtMs: number;
  readonly nowMs: number;
  readonly cooldownMs?: number;
}): boolean {
  if (!Number.isInteger(input.pendingIncomingCount) || input.pendingIncomingCount < 0) {
    throw new Error("pendingIncomingCount must be a non-negative integer");
  }
  if (!Number.isFinite(input.lastSyncAttemptAtMs) || input.lastSyncAttemptAtMs < 0) {
    throw new Error("lastSyncAttemptAtMs must be a non-negative timestamp");
  }
  if (!Number.isFinite(input.nowMs) || input.nowMs < 0) {
    throw new Error("nowMs must be a non-negative timestamp");
  }

  const cooldownMs = input.cooldownMs ?? MERCHANT_AUTO_SYNC_COOLDOWN_MS;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error("cooldownMs must be a non-negative duration");
  }

  if (!input.isMerchant || !input.isOnline || !input.jwtFresh) {
    return false;
  }
  if (input.pendingIncomingCount === 0 || input.isSyncInFlight) {
    return false;
  }
  if (input.lastSyncAttemptAtMs > 0 && input.nowMs - input.lastSyncAttemptAtMs < cooldownMs) {
    return false;
  }

  return true;
}
