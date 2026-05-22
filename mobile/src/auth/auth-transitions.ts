import type { Me } from "../api/auth";
import type { AppState } from "./auth-state";
import { isJwtExpired } from "./jwt-decode";
import { isRealMeProfile } from "./profile-cache";

export type LockedAuthState = Extract<AppState, { readonly status: "locked" }>;

export function toLockedOrUnauthed(
  user: Me | null | undefined,
  options: {
    readonly hasJwt: boolean;
    readonly jwtFreshAfterUnlock?: boolean;
  },
): AppState {
  if (!isRealMeProfile(user)) {
    return { status: "unauthed" };
  }

  return {
    status: "locked",
    user,
    hasJwt: options.hasJwt,
    jwtFreshAfterUnlock: options.jwtFreshAfterUnlock,
  };
}

export function unlockLockedState(
  lockedState: LockedAuthState,
  token: string | null,
): AppState {
  if (!isRealMeProfile(lockedState.user)) {
    return { status: "unauthed" };
  }

  const jwtFresh =
    lockedState.jwtFreshAfterUnlock ??
    (token !== null && !isJwtExpired(token));

  return {
    status: "authed",
    user: lockedState.user,
    jwtFresh,
  };
}
