import { fetchMe } from "../api/auth";
import {
  getLocalState,
  setLocalState,
  sumPendingOutgoingKobo,
} from "../ledger/db";

export interface SpendableBalanceSnapshot {
  readonly verifiedBalanceKobo: number;
  readonly pendingOutgoingKobo: number;
  readonly spendableBalanceKobo: number;
  readonly source: "server" | "local";
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

export async function getSpendableBalanceSnapshot(): Promise<SpendableBalanceSnapshot> {
  let verifiedBalanceKobo: number | null = null;
  let source: "server" | "local" = "local";

  try {
    const fresh = await fetchMe();
    verifiedBalanceKobo = Number(fresh.verifiedBalanceKobo);
    assertValidKobo(verifiedBalanceKobo, "server balance");

    setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
    setLocalState("last_sync_at", new Date().toISOString());
    source = "server";
  } catch {
    verifiedBalanceKobo = parseStoredKobo(getLocalState("verified_balance_kobo"));
  }

  if (verifiedBalanceKobo === null) {
    throw new Error(
      "No verified balance available. Open the app online to sync your balance.",
    );
  }

  const pendingOutgoingKobo = sumPendingOutgoingKobo();
  assertValidKobo(pendingOutgoingKobo, "pending outgoing balance");

  return {
    verifiedBalanceKobo,
    pendingOutgoingKobo,
    spendableBalanceKobo: verifiedBalanceKobo - pendingOutgoingKobo,
    source,
  };
}
