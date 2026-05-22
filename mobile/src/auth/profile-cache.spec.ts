jest.mock("../ledger/db", () => ({
  getLocalState: jest.fn(),
  setLocalState: jest.fn(),
}));

import type { Me } from "../api/auth";
import { getLocalState, setLocalState } from "../ledger/db";
import {
  CACHED_ME_PROFILE_KEY,
  isRealMeProfile,
  loadCachedMeProfile,
  persistMeProfile,
} from "./profile-cache";

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

describe("profile cache", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("persists a successful /me profile and balance cache", () => {
    const me = makeMe();

    persistMeProfile(me);

    expect(setLocalState).toHaveBeenCalledWith(
      CACHED_ME_PROFILE_KEY,
      JSON.stringify(me),
    );
    expect(setLocalState).toHaveBeenCalledWith("verified_balance_kobo", "150000");
    expect(setLocalState).toHaveBeenCalledWith("last_sync_at", expect.any(String));
  });

  it("loads a cached real profile for offline boot", () => {
    const me = makeMe({ verifiedBalanceKobo: "200000" });
    (getLocalState as jest.Mock).mockReturnValue(JSON.stringify(me));

    expect(loadCachedMeProfile()).toEqual(me);
  });

  it("rejects sentinel placeholder profiles", () => {
    expect(isRealMeProfile(makeMe({ id: "u_0000000000000000" }))).toBe(false);
    expect(isRealMeProfile(makeMe({ id: "u_000000000000" }))).toBe(false);
  });

  it("rejects cached profiles without a real email", () => {
    (getLocalState as jest.Mock).mockReturnValue(
      JSON.stringify(makeMe({ email: "" })),
    );

    expect(loadCachedMeProfile()).toBeNull();
  });

  it("does not create a placeholder when no cached profile exists", () => {
    (getLocalState as jest.Mock).mockReturnValue(null);

    expect(loadCachedMeProfile()).toBeNull();
  });

  it("later /me persistence overwrites a stale cached profile", () => {
    const fresh = makeMe({
      email: "fresh.student@example.com",
      verifiedBalanceKobo: "250000",
    });

    persistMeProfile(fresh);

    expect(setLocalState).toHaveBeenCalledWith(
      CACHED_ME_PROFILE_KEY,
      JSON.stringify(fresh),
    );
    expect(setLocalState).toHaveBeenCalledWith("verified_balance_kobo", "250000");
  });
});
