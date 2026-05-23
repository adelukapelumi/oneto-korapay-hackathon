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
  serverConfirmedBalanceKobo: number,
  source: "server" | "local",
  lastSyncedAt: string | null,
): StudentBalanceProjection {
  assertValidKobo(serverConfirmedBalanceKobo, "server-confirmed balance");

  const pendingOutgoingKobo = sumPendingOutgoingKobo();
  assertValidKobo(pendingOutgoingKobo, "pending outgoing balance");

  const pendingOutgoingCount = listPendingByStatus(
    "pending_reconciliation",
    "outgoing",
  ).length;
  const availableBalanceKobo =
    serverConfirmedBalanceKobo - pendingOutgoingKobo;

  logger.debug("balance_projection_computed", {
    serverConfirmedBalanceKobo,
    pendingOutgoingKobo,
    availableBalanceKobo,
    pendingOutgoingCount,
    source,
    timestamp: new Date().toISOString(),
  });

  return {
    serverConfirmedBalanceKobo,
    pendingOutgoingKobo,
    availableBalanceKobo,
    pendingOutgoingCount,
    lastSyncedAt,
    source,
  };
}

export function getStoredStudentBalanceProjection(): StudentBalanceProjection | null {
  const storedBalanceKobo = parseStoredKobo(getLocalState("verified_balance_kobo"));
  if (storedBalanceKobo === null) {
    return null;
  }

  return buildProjection(
    storedBalanceKobo,
    "local",
    getLocalState("last_sync_at"),
  );
}

export async function getStudentBalanceProjection(
  onFreshProfile?: (me: Me) => void,
  options: StudentBalanceProjectionOptions = {},
): Promise<StudentBalanceProjection> {
  let serverConfirmedBalanceKobo: number | null = null;
  let source: "server" | "local" = "local";
  let lastSyncedAt = getLocalState("last_sync_at");

  if (options.syncOutgoingPending ?? true) {
    await syncOutgoingPendingFromServerLedger();
  }

  try {
    const fresh = await fetchMe();
    persistMeProfile(fresh);
    onFreshProfile?.(fresh);
    serverConfirmedBalanceKobo = Number(fresh.verifiedBalanceKobo);
    assertValidKobo(serverConfirmedBalanceKobo, "server balance");

    setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
    lastSyncedAt = new Date().toISOString();
    setLocalState("last_sync_at", lastSyncedAt);
    source = "server";
  } catch {
    serverConfirmedBalanceKobo = parseStoredKobo(
      getLocalState("verified_balance_kobo"),
    );
  }

  if (serverConfirmedBalanceKobo === null) {
    throw new Error(
      "No verified balance available. Open the app online to sync your balance.",
    );
  }

  return buildProjection(serverConfirmedBalanceKobo, source, lastSyncedAt);
}

export async function getSpendableBalanceSnapshot(): Promise<SpendableBalanceSnapshot> {
  return getStudentBalanceProjection();
}
