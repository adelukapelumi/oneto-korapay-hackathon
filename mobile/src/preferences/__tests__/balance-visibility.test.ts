jest.mock("../../ledger/db", () => ({
  getLocalState: jest.fn(),
  setLocalState: jest.fn(),
}));

import { getLocalState, setLocalState } from "../../ledger/db";
import {
  BALANCE_HIDDEN_KEY,
  getBalanceHiddenPreference,
  maskNairaAmount,
  setBalanceHiddenPreference,
} from "../balance-visibility";

const getLocalStateMock = jest.mocked(getLocalState);
const setLocalStateMock = jest.mocked(setLocalState);

describe("balance visibility preference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when no preference exists", () => {
    getLocalStateMock.mockReturnValue(null);

    expect(getBalanceHiddenPreference()).toBe(false);
    expect(getLocalStateMock).toHaveBeenCalledWith(BALANCE_HIDDEN_KEY);
  });

  it("returns false when value is false", () => {
    getLocalStateMock.mockReturnValue("false");

    expect(getBalanceHiddenPreference()).toBe(false);
  });

  it("returns true when value is true", () => {
    getLocalStateMock.mockReturnValue("true");

    expect(getBalanceHiddenPreference()).toBe(true);
  });

  it("returns false for malformed values", () => {
    getLocalStateMock.mockReturnValue("yes");
    expect(getBalanceHiddenPreference()).toBe(false);

    getLocalStateMock.mockReturnValue("1");
    expect(getBalanceHiddenPreference()).toBe(false);
  });

  it("writes true when hiding balances", () => {
    setBalanceHiddenPreference(true);

    expect(setLocalStateMock).toHaveBeenCalledWith(BALANCE_HIDDEN_KEY, "true");
  });

  it("writes false when showing balances", () => {
    setBalanceHiddenPreference(false);

    expect(setLocalStateMock).toHaveBeenCalledWith(BALANCE_HIDDEN_KEY, "false");
  });

  it("returns the masked naira amount string", () => {
    expect(maskNairaAmount()).toBe("₦••••••");
  });
});
