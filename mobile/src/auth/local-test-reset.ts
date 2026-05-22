import { clearToken } from "./token-store";
import { clearCachedMeProfile } from "./profile-cache";
import {
  wipeKeypair,
  wipePendingRecoveryKeypair,
} from "../crypto/keypair-store";
import { wipeLocalTestingData } from "../ledger/db";

export interface WipeLocalPaymentKeyOnlyForTestingDeps {
  readonly wipeActiveKeypairFn: () => Promise<void>;
}

export interface ResetLocalAppForTestingDeps {
  readonly clearTokenFn: () => Promise<void>;
  readonly wipeActiveKeypairFn: () => Promise<void>;
  readonly wipePendingRecoveryKeypairFn: () => Promise<void>;
  readonly clearCachedProfileFn: () => void;
  readonly wipeSqliteLocalDataFn: () => void;
  readonly wipeInMemoryKeyFn?: () => void;
  readonly clearInMemoryPendingRecoveryKeypairFn?: () => void;
}

export async function wipeLocalPaymentKeyOnlyForTesting(
  deps: WipeLocalPaymentKeyOnlyForTestingDeps = {
    wipeActiveKeypairFn: wipeKeypair,
  },
): Promise<void> {
  await deps.wipeActiveKeypairFn();
}

export async function resetLocalAppForTesting(
  deps: ResetLocalAppForTestingDeps = {
    clearTokenFn: clearToken,
    wipeActiveKeypairFn: wipeKeypair,
    wipePendingRecoveryKeypairFn: wipePendingRecoveryKeypair,
    clearCachedProfileFn: clearCachedMeProfile,
    wipeSqliteLocalDataFn: wipeLocalTestingData,
  },
): Promise<void> {
  // Local-only test reset. This intentionally has no backend dependency:
  // server-side UserDeviceKey rows and ledger history must survive this.
  await Promise.all([
    deps.clearTokenFn(),
    deps.wipeActiveKeypairFn(),
    deps.wipePendingRecoveryKeypairFn(),
  ]);

  deps.wipeInMemoryKeyFn?.();
  deps.clearInMemoryPendingRecoveryKeypairFn?.();
  deps.clearCachedProfileFn();
  deps.wipeSqliteLocalDataFn();
}
