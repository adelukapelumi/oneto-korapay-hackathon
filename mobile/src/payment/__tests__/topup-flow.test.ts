import {
  requestTopup,
  TopupAmountError,
  MIN_TOPUP_KOBO,
  MAX_TOPUP_KOBO,
  TOPUP_AMOUNT_ROUTE,
} from "../topup-flow";
import { initiateTopup } from "../../api/topup";

jest.mock("../../api/topup");

describe("requestTopup", () => {
  const mockInitiateTopup = initiateTopup as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps the top-up amount route aligned with the existing Expo route", () => {
    expect(TOPUP_AMOUNT_ROUTE).toBe("/(app)/topup/amount");
  });

  it("should reject if amount is below minimum", async () => {
    await expect(requestTopup(MIN_TOPUP_KOBO - 1)).rejects.toThrow(TopupAmountError);
    await expect(requestTopup(MIN_TOPUP_KOBO - 1)).rejects.toThrow(/Minimum top-up is/);
    expect(mockInitiateTopup).not.toHaveBeenCalled();
  });

  it("should reject if amount is above maximum", async () => {
    await expect(requestTopup(MAX_TOPUP_KOBO + 1)).rejects.toThrow(TopupAmountError);
    await expect(requestTopup(MAX_TOPUP_KOBO + 1)).rejects.toThrow(/Maximum top-up is/);
    expect(mockInitiateTopup).not.toHaveBeenCalled();
  });

  it("should reject if amount is not an integer", async () => {
    await expect(requestTopup(50000.5)).rejects.toThrow(TopupAmountError);
    await expect(requestTopup(50000.5)).rejects.toThrow(/whole number/);
    expect(mockInitiateTopup).not.toHaveBeenCalled();
  });

  it("should call initiateTopup if amount is valid", async () => {
    mockInitiateTopup.mockResolvedValueOnce({
      reference: "top_123",
      paymentUrl: "https://checkout.korapay.com/pay/123",
    });

    const res = await requestTopup(50000);
    expect(res.reference).toBe("top_123");
    expect(res.paymentUrl).toBe("https://checkout.korapay.com/pay/123");
    expect(mockInitiateTopup).toHaveBeenCalledWith(50000);
  });
});
