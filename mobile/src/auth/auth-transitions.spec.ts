jest.mock("../ledger/db", () => ({
  getLocalState: jest.fn(),
  setLocalState: jest.fn(),
}));

import type { Me } from "../api/auth";
import {
  toLockedOrUnauthed,
  unlockLockedState,
  type LockedAuthState,
} from "./auth-transitions";

function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "u_0123456789abcdef",
    email: "student@example.com",
    phone: null,
    role: "STUDENT",
    status: "ACTIVE",
    verifiedBalanceKobo: "150000",
    createdAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("auth transitions", () => {
  it("offline boot can enter locked state with a cached real profile", () => {
    const cachedProfile = makeMe();

    expect(
      toLockedOrUnauthed(cachedProfile, {
        hasJwt: false,
        jwtFreshAfterUnlock: false,
      }),
    ).toEqual({
      status: "locked",
      user: cachedProfile,
      hasJwt: false,
      jwtFreshAfterUnlock: false,
    });
  });

  it("offline boot without a cached profile does not create an authenticated user", () => {
    expect(
      toLockedOrUnauthed(null, {
        hasJwt: false,
        jwtFreshAfterUnlock: false,
      }),
    ).toEqual({ status: "unauthed" });
  });

  it("does not promote a placeholder profile on PIN unlock", () => {
    const lockedState: LockedAuthState = {
      status: "locked",
      user: makeMe({ id: "u_0000000000000000", email: "" }),
      hasJwt: true,
    };

    expect(unlockLockedState(lockedState, "still-not-trusted-here")).toEqual({
      status: "unauthed",
    });
  });

  it("unlocks cached offline profile with stale online freshness", () => {
    const cachedProfile = makeMe();
    const lockedState: LockedAuthState = {
      status: "locked",
      user: cachedProfile,
      hasJwt: false,
      jwtFreshAfterUnlock: false,
    };

    expect(unlockLockedState(lockedState, null)).toEqual({
      status: "authed",
      user: cachedProfile,
      jwtFresh: false,
    });
  });
});
