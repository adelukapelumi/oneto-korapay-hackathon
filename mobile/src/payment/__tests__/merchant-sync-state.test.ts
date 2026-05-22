import {
  getMerchantSyncButtonState,
  shouldRequestMerchantAutoSync,
} from "../merchant-sync-state";

describe("merchant sync state", () => {
  it("renders a stable offline button with pending payments", () => {
    expect(
      getMerchantSyncButtonState({
        isOnline: false,
        isSyncing: false,
        jwtFresh: true,
        pendingIncomingCount: 2,
      }),
    ).toEqual({
      label: "Connect to sync",
      disabled: true,
      showLoading: false,
    });
  });

  it("enables manual sync when online with pending payments", () => {
    expect(
      getMerchantSyncButtonState({
        isOnline: true,
        isSyncing: false,
        jwtFresh: true,
        pendingIncomingCount: 2,
      }),
    ).toEqual({
      label: "Sync Now",
      disabled: false,
      showLoading: false,
    });
  });

  it("shows loading only while online syncing", () => {
    expect(
      getMerchantSyncButtonState({
        isOnline: true,
        isSyncing: true,
        jwtFresh: true,
        pendingIncomingCount: 2,
      }),
    ).toEqual({
      label: "Syncing...",
      disabled: true,
      showLoading: true,
    });
  });

  it("disables sync when there are no pending payments", () => {
    expect(
      getMerchantSyncButtonState({
        isOnline: true,
        isSyncing: false,
        jwtFresh: true,
        pendingIncomingCount: 0,
      }),
    ).toEqual({
      label: "All synced",
      disabled: true,
      showLoading: false,
    });
  });

  it("does not auto-sync while offline", () => {
    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: false,
        jwtFresh: true,
        pendingIncomingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("requests one auto-sync on online transition with pending payments", () => {
    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: true,
        jwtFresh: true,
        pendingIncomingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(true);
  });

  it("does not auto-sync without pending payments", () => {
    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: true,
        jwtFresh: true,
        pendingIncomingCount: 0,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("does not start duplicate auto-sync while one is in flight", () => {
    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: true,
        jwtFresh: true,
        pendingIncomingCount: 1,
        isSyncInFlight: true,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("applies cooldown after a failed network attempt", () => {
    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: true,
        jwtFresh: true,
        pendingIncomingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 10_000,
        nowMs: 20_000,
        cooldownMs: 15_000,
      }),
    ).toBe(false);

    expect(
      shouldRequestMerchantAutoSync({
        isMerchant: true,
        isOnline: true,
        jwtFresh: true,
        pendingIncomingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 10_000,
        nowMs: 25_001,
        cooldownMs: 15_000,
      }),
    ).toBe(true);
  });
});
