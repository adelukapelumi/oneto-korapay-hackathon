import {
  getStudentOutgoingSyncStatus,
  shouldRequestStudentOutgoingAutoSync,
} from "../student-sync-state";

describe("student outgoing sync state", () => {
  it("does not auto-sync while offline and asks the user to retry later", () => {
    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: false,
        jwtFresh: true,
        pendingOutgoingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);

    expect(
      getStudentOutgoingSyncStatus({
        pendingOutgoingCount: 1,
        isOnline: false,
        isSyncing: false,
        markedTerminal: 0,
        hasNetworkError: true,
        checkedAtMs: null,
      }).message,
    ).toBe("Could not check status. Will retry when online.");
  });

  it("requests one auto-sync when online with pending outgoing payments", () => {
    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: true,
        jwtFresh: true,
        pendingOutgoingCount: 2,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(true);
  });

  it("does not auto-sync when there are no pending outgoing payments", () => {
    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: true,
        jwtFresh: true,
        pendingOutgoingCount: 0,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("does not start duplicate auto-sync while one is in flight", () => {
    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: true,
        jwtFresh: true,
        pendingOutgoingCount: 1,
        isSyncInFlight: true,
        lastSyncAttemptAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("applies cooldown after a network failure and retries after cooldown", () => {
    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: true,
        jwtFresh: true,
        pendingOutgoingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 10_000,
        nowMs: 20_000,
        cooldownMs: 15_000,
      }),
    ).toBe(false);

    expect(
      shouldRequestStudentOutgoingAutoSync({
        isStudent: true,
        isOnline: true,
        jwtFresh: true,
        pendingOutgoingCount: 1,
        isSyncInFlight: false,
        lastSyncAttemptAtMs: 10_000,
        nowMs: 25_001,
        cooldownMs: 15_000,
      }),
    ).toBe(true);
  });

  it("shows loading while a pending outgoing sync is in flight", () => {
    expect(
      getStudentOutgoingSyncStatus({
        pendingOutgoingCount: 1,
        isOnline: true,
        isSyncing: true,
        markedTerminal: 0,
        hasNetworkError: false,
        checkedAtMs: null,
      }),
    ).toEqual({
      kind: "syncing",
      message: "Syncing pending payments...",
    });
  });

  it("shows waiting when backend still returns unknown_pending", () => {
    expect(
      getStudentOutgoingSyncStatus({
        pendingOutgoingCount: 1,
        isOnline: true,
        isSyncing: false,
        markedTerminal: 0,
        hasNetworkError: false,
        checkedAtMs: 10_000,
      }),
    ).toEqual({
      kind: "waiting_for_merchant",
      message: "Waiting for merchant to sync. Last checked just now.",
    });
  });

  it("shows updated only after at least one backend terminal status", () => {
    expect(
      getStudentOutgoingSyncStatus({
        pendingOutgoingCount: 0,
        isOnline: true,
        isSyncing: false,
        markedTerminal: 1,
        hasNetworkError: false,
        checkedAtMs: 10_000,
      }),
    ).toEqual({
      kind: "updated",
      message: "Payment status updated. Balance refreshed.",
    });
  });
});
