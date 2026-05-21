jest.mock("react-native", () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("../ledger/db", () => ({
  initDb: jest.fn(),
  setLocalState: jest.fn(),
}));

import { ApiError } from "../api/errors";
import {
  isUserNotFoundError,
  resetLocalAuthAfterMissingUser,
} from "./bootstrap-recovery";

describe("auth-provider stale-user recovery", () => {
  it("detects user_not_found by message, code, or 404 status", () => {
    expect(isUserNotFoundError(new ApiError("user_not_found", 400))).toBe(true);
    expect(
      isUserNotFoundError(new ApiError("missing", 400, "user_not_found")),
    ).toBe(true);
    expect(isUserNotFoundError(new ApiError("missing", 404))).toBe(true);
    expect(isUserNotFoundError(new ApiError("different", 400))).toBe(false);
  });

  it("wipes local auth state when backend user is missing", async () => {
    const clearTokenFn = jest.fn<Promise<void>, []>(() => Promise.resolve());
    const clearAttemptsFn = jest.fn<Promise<void>, []>(() => Promise.resolve());
    const wipeKeypairFn = jest.fn<Promise<void>, []>(() => Promise.resolve());
    const wipeInMemoryKeyFn = jest.fn<void, []>();

    await resetLocalAuthAfterMissingUser({
      clearTokenFn,
      clearAttemptsFn,
      wipeKeypairFn,
      wipeInMemoryKeyFn,
    });

    expect(clearTokenFn).toHaveBeenCalledTimes(1);
    expect(clearAttemptsFn).toHaveBeenCalledTimes(1);
    expect(wipeKeypairFn).toHaveBeenCalledTimes(1);
    expect(wipeInMemoryKeyFn).toHaveBeenCalledTimes(1);
  });
});
