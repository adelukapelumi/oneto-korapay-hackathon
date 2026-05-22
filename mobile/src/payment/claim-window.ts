import { OFFLINE_CLAIM_WINDOW_HOURS } from "@oneto/shared";

const OFFLINE_CLAIM_WINDOW_MS = OFFLINE_CLAIM_WINDOW_HOURS * 60 * 60 * 1000;

export function getClaimDeadlineAtIso(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + OFFLINE_CLAIM_WINDOW_MS).toISOString();
}

export function formatClaimDeadline(timestamp: string): string {
  return new Date(getClaimDeadlineAtIso(timestamp)).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
