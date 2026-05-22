import { z } from "zod";
import type { Me } from "../api/auth";
import { deleteLocalState, getLocalState, setLocalState } from "../ledger/db";

export const CACHED_ME_PROFILE_KEY = "cached_me_profile_json";

const SENTINEL_USER_IDS = new Set([
  "u_000000000000",
  "u_0000000000000000",
]);

const CachedMeProfileSchema = z.object({
  id: z.string().regex(/^u_[0-9a-f]{16}$/),
  email: z.string().trim().min(1),
  phone: z.string().nullable(),
  role: z.enum(["STUDENT", "MERCHANT", "ADMIN"]),
  status: z.enum(["ACTIVE", "PENDING_VERIFICATION", "FROZEN", "FLAGGED"]),
  verifiedBalanceKobo: z.string().regex(/^\d+$/),
  createdAt: z.string().min(1),
});

export function isRealMeProfile(me: Me | null | undefined): me is Me {
  if (!me) {
    return false;
  }
  if (SENTINEL_USER_IDS.has(me.id)) {
    return false;
  }
  return CachedMeProfileSchema.safeParse(me).success;
}

export function persistMeProfile(me: Me): void {
  if (!isRealMeProfile(me)) {
    throw new Error("Refusing to cache invalid user profile");
  }

  setLocalState(CACHED_ME_PROFILE_KEY, JSON.stringify(me));
  setLocalState("verified_balance_kobo", me.verifiedBalanceKobo);
  setLocalState("last_sync_at", new Date().toISOString());
}

export function loadCachedMeProfile(): Me | null {
  const raw = getLocalState(CACHED_ME_PROFILE_KEY);
  if (raw === null) {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = CachedMeProfileSchema.safeParse(parsedJson);
  if (!parsed.success || SENTINEL_USER_IDS.has(parsed.data.id)) {
    return null;
  }

  return parsed.data;
}

export function clearCachedMeProfile(): void {
  deleteLocalState(CACHED_ME_PROFILE_KEY);
  deleteLocalState("verified_balance_kobo");
  deleteLocalState("last_sync_at");
}
