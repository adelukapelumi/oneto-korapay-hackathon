jest.mock("../ledger/db", () => ({
  wipeLocalTestingData: jest.fn(),
}));

jest.mock("../crypto/keypair-store", () => ({
  wipeKeypair: jest.fn(),
  wipePendingRecoveryKeypair: jest.fn(),
}));

jest.mock("./token-store", () => ({
  clearToken: jest.fn(),
}));

jest.mock("./profile-cache", () => ({
  clearCachedMeProfile: jest.fn(),
}));

import {
  resetLocalAppForTesting,
  wipeLocalPaymentKeyOnlyForTesting,
  type ResetLocalAppForTestingDeps,
} from "./local-test-reset";

function resolvedFn(calls: string[], name: string): () => Promise<void> {
  return jest.fn<Promise<void>, []>(() => {
    calls.push(name);
    return Promise.resolve();
  });
}

function syncFn(calls: string[], name: string): () => void {
  return jest.fn<void, []>(() => {
    calls.push(name);
  });
}

describe("local testing reset helpers", () => {
  it("wipes only the active payment key for the key-only testing action", async () => {
    const wipeActiveKeypairFn = jest.fn<Promise<void>, []>(() =>
      Promise.resolve(),
    );

    await wipeLocalPaymentKeyOnlyForTesting({ wipeActiveKeypairFn });

    expect(wipeActiveKeypairFn).toHaveBeenCalledTimes(1);
  });

  it("clears all local app state for the full local reset without backend calls", async () => {
    const calls: string[] = [];
    const backendUnlinkDeviceKeyFn = jest.fn<Promise<void>, []>(() =>
      Promise.resolve(),
    );
    const deps: ResetLocalAppForTestingDeps = {
      clearTokenFn: resolvedFn(calls, "token"),
      wipeActiveKeypairFn: resolvedFn(calls, "active-keypair"),
      wipePendingRecoveryKeypairFn: resolvedFn(calls, "pending-recovery"),
      wipeInMemoryKeyFn: syncFn(calls, "in-memory-key"),
      clearInMemoryPendingRecoveryKeypairFn: syncFn(
        calls,
        "in-memory-pending-recovery",
      ),
      clearCachedProfileFn: syncFn(calls, "cached-profile"),
      wipeSqliteLocalDataFn: syncFn(calls, "sqlite"),
    };

    await resetLocalAppForTesting(deps);

    expect(calls).toEqual([
      "token",
      "active-keypair",
      "pending-recovery",
      "in-memory-key",
      "in-memory-pending-recovery",
      "cached-profile",
      "sqlite",
    ]);
    expect(backendUnlinkDeviceKeyFn).not.toHaveBeenCalled();
  });

  it("does not clear SQLite if key material wipe fails", async () => {
    const clearTokenFn = jest.fn<Promise<void>, []>(() => Promise.resolve());
    const wipeActiveKeypairFn = jest.fn<Promise<void>, []>(() =>
      Promise.reject(new Error("secure-store failed")),
    );
    const wipePendingRecoveryKeypairFn = jest.fn<Promise<void>, []>(() =>
      Promise.resolve(),
    );
    const clearCachedProfileFn = jest.fn<void, []>();
    const wipeSqliteLocalDataFn = jest.fn<void, []>();

    await expect(
      resetLocalAppForTesting({
        clearTokenFn,
        wipeActiveKeypairFn,
        wipePendingRecoveryKeypairFn,
        clearCachedProfileFn,
        wipeSqliteLocalDataFn,
      }),
    ).rejects.toThrow("secure-store failed");

    expect(clearTokenFn).toHaveBeenCalledTimes(1);
    expect(wipeActiveKeypairFn).toHaveBeenCalledTimes(1);
    expect(wipePendingRecoveryKeypairFn).toHaveBeenCalledTimes(1);
    expect(clearCachedProfileFn).not.toHaveBeenCalled();
    expect(wipeSqliteLocalDataFn).not.toHaveBeenCalled();
  });
});
