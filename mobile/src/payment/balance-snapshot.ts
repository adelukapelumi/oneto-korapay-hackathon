import { fetchMe } from "../api/auth";
import type { Me } from "../api/auth";
import {
  getLocalState,
  listPendingByStatus,
  setLocalState,
  sumPendingOutgoingKobo,
} from "../ledger/db";
import { logger } from "../lib/logger";
import { persistMeProfile } from "../auth/profile-cache";
import { syncOutgoingPendingFromServerLedger } from "./sync-outgoing";

export interface StudentBalanceProjection {
  readonly verifiedBalanceKobo: number;
  readonly recoveryHeldBalanceKobo: number;
  readonly recoveryHoldUntil: string | null;
  readonly serverConfirmedBalanceKobo: number;
  readonly pendingOutgoingKobo: number;
  readonly availableBalanceKobo: number;
  readonly pendingOutgoingCount: number;
  readonly lastSyncedAt: string | null;
  readonly source: "server" | "local";
}

export type SpendableBalanceSnapshot = StudentBalanceProjection;

export interface StudentBalanceProjectionOptions {
  readonly syncOutgoingPending?: boolean;
}

function parseStoredKobo(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function assertValidKobo(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function buildProjection(
  input: {
    readonly verifiedBalanceKobo: number;
    readonly serverConfirmedBalanceKobo: number;
    readonly recoveryHeldBalanceKobo: number;
    readonly recoveryHoldUntil: string | null;
  },
  source: "server" | "local",
  lastSyncedAt: string | null,
): StudentBalanceProjection {
  assertValidKobo(input.verifiedBalanceKobo, "verified balance");
  assertValidKobo(input.serverConfirmedBalanceKobo, "server-confirmed balance");
  assertValidKobo(input.recoveryHeldBalanceKobo, "recovery held balance");

  const pendingOutgoingKobo = sumPendingOutgoingKobo();
  assertValidKobo(pendingOutgoingKobo, "pending outgoing balance");

  const pendingOutgoingCount = listPendingByStatus(
    "pending_reconciliation",
    "outgoing",
  ).length;
  const availableBalanceKobo =
    input.serverConfirmedBalanceKobo - pendingOutgoingKobo;

  logger.debug("balance_projection_computed", {
    verifiedBalanceKobo: input.verifiedBalanceKobo,
    serverConfirmedBalanceKobo: input.serverConfirmedBalanceKobo,
    recoveryHeldBalanceKobo: input.recoveryHeldBalanceKobo,
    pendingOutgoingKobo,
    availableBalanceKobo,
    pendingOutgoingCount,
    source,
    timestamp: new Date().toISOString(),
  });

  return {
    verifiedBalanceKobo: input.verifiedBalanceKobo,
    recoveryHeldBalanceKobo: input.recoveryHeldBalanceKobo,
    recoveryHoldUntil: input.recoveryHoldUntil,
    serverConfirmedBalanceKobo: input.serverConfirmedBalanceKobo,
    pendingOutgoingKobo,
    availableBalanceKobo,
    pendingOutgoingCount,
    lastSyncedAt,
    source,
  };
}

export function getStoredStudentBalanceProjection(): StudentBalanceProjection | null {
  const storedVerifiedBalanceKobo = parseStoredKobo(
    getLocalState("verified_balance_kobo"),
  );
  const storedAvailableBalanceKobo = parseStoredKobo(
    getLocalState("available_balance_kobo"),
  );
  if (storedVerifiedBalanceKobo === null) {
    return null;
  }

  return buildProjection(
    {
      verifiedBalanceKobo: storedVerifiedBalanceKobo,
      serverConfirmedBalanceKobo:
        storedAvailableBalanceKobo ?? storedVerifiedBalanceKobo,
      recoveryHeldBalanceKobo: Math.max(
        0,
        storedVerifiedBalanceKobo -
          (storedAvailableBalanceKobo ?? storedVerifiedBalanceKobo),
      ),
      recoveryHoldUntil: null,
    },
    "local",
    getLocalState("last_sync_at"),
  );
}

export async function getStudentBalanceProjection(
  onFreshProfile?: (me: Me) => void,
  options: StudentBalanceProjectionOptions = {},
): Promise<StudentBalanceProjection> {
  let projectionBase:
    | {
        verifiedBalanceKobo: number;
        serverConfirmedBalanceKobo: number;
        recoveryHeldBalanceKobo: number;
        recoveryHoldUntil: string | null;
      }
    | null = null;
  let source: "server" | "local" = "local";
  let lastSyncedAt = getLocalState("last_sync_at");

  if (options.syncOutgoingPending ?? true) {
    await syncOutgoingPendingFromServerLedger();
  }

  try {
    const fresh = await fetchMe();
    persistMeProfile(fresh);
    onFreshProfile?.(fresh);
    projectionBase = {
      verifiedBalanceKobo: Number(fresh.verifiedBalanceKobo),
      serverConfirmedBalanceKobo: Number(fresh.availableBalanceKobo),
      recoveryHeldBalanceKobo: Number(fresh.recoveryHeldBalanceKobo),
      recoveryHoldUntil: fresh.recoveryHoldUntil,
    };
    assertValidKobo(projectionBase.verifiedBalanceKobo, "verified balance");
    assertValidKobo(projectionBase.serverConfirmedBalanceKobo, "available balance");
    assertValidKobo(
      projectionBase.recoveryHeldBalanceKobo,
      "recovery held balance",
    );

    setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
    setLocalState("available_balance_kobo", fresh.availableBalanceKobo);
    lastSyncedAt = new Date().toISOString();
    setLocalState("last_sync_at", lastSyncedAt);
    source = "server";
  } catch {
    const storedVerifiedBalanceKobo = parseStoredKobo(
      getLocalState("verified_balance_kobo"),
    );
    if (storedVerifiedBalanceKobo !== null) {
      const storedAvailableBalanceKobo =
        parseStoredKobo(getLocalState("available_balance_kobo")) ??
        storedVerifiedBalanceKobo;
      projectionBase = {
        verifiedBalanceKobo: storedVerifiedBalanceKobo,
        serverConfirmedBalanceKobo: storedAvailableBalanceKobo,
        recoveryHeldBalanceKobo: Math.max(
          0,
          storedVerifiedBalanceKobo - storedAvailableBalanceKobo,
        ),
        recoveryHoldUntil: null,
      };
    }
  }

  if (projectionBase === null) {
    throw new Error(
      "No verified balance available. Open the app online to sync your balance.",
    );
  }

  return buildProjection(projectionBase, source, lastSyncedAt);
}

export async function getSpendableBalanceSnapshot(): Promise<SpendableBalanceSnapshot> {
  return getStudentBalanceProjection();
}
