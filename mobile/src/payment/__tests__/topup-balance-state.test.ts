import { buildTopupBalanceDisplay } from "../topup-balance-state";
import type { StudentBalanceProjection } from "../balance-snapshot";

function makeProjection(overrides: Partial<StudentBalanceProjection>): StudentBalanceProjection {
  return {
    serverConfirmedBalanceKobo: 500_000,
    pendingOutgoingKobo: 150_000,
    availableBalanceKobo: 350_000,
    pendingOutgoingCount: 1,
    lastSyncedAt: "2026-05-01T10:00:00.000Z",
    source: "server",
    ...overrides,
  };
}

describe("buildTopupBalanceDisplay", () => {
  it("shows projected available balance instead of raw server balance", () => {
    expect(
      buildTopupBalanceDisplay({
        projection: makeProjection({}),
        fallbackServerBalanceKobo: 500_000,
        topupAmountKobo: 100_000,
      }),
    ).toEqual({
      currentBalanceKobo: 350_000,
      newBalanceKobo: 450_000,
      pendingOutgoingKobo: 150_000,
      pendingOutgoingCount: 1,
      isProjected: true,
    });
  });

  it("falls back to raw server balance when no projection is available", () => {
    expect(
      buildTopupBalanceDisplay({
        projection: null,
        fallbackServerBalanceKobo: 500_000,
        topupAmountKobo: 100_000,
      }),
    ).toEqual({
      currentBalanceKobo: 500_000,
      newBalanceKobo: 600_000,
      pendingOutgoingKobo: 0,
      pendingOutgoingCount: 0,
      isProjected: false,
    });
  });
});
