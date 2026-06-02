import { getLocalState, setLocalState } from "../ledger/db";

export const BALANCE_HIDDEN_KEY = "ui_balance_hidden";

export function getBalanceHiddenPreference(): boolean {
  return getLocalState(BALANCE_HIDDEN_KEY) === "true";
}

export function setBalanceHiddenPreference(hidden: boolean): void {
  setLocalState(BALANCE_HIDDEN_KEY, hidden ? "true" : "false");
}

export function maskNairaAmount(): string {
  return "₦••••••";
}
