import { requestCashout, getCashoutStatus } from "../cashout";
import { apiClient } from "../client";
import { ApiError } from "../errors";

jest.mock("../client");

describe("Cashout API", () => {
  const mockPost = apiClient.post as jest.Mock;
  const mockGet = apiClient.get as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("requestCashout", () => {
    it("should return cashout details on success", async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          cashout: {
            id: "cash_123",
            amountKobo: "5000",
            grossAmountKobo: "5000",
            onetoFeeBps: 250,
            onetoFeeKobo: "125",
            korapayPayoutFeeKobo: null,
            netPayoutKobo: null,
            finalPayoutAmountKobo: null,
            status: "PENDING",
            requestedAt: "2023-10-10T10:00:00.000Z",
          },
        },
      });

      const res = await requestCashout();
      expect(res.id).toBe("cash_123");
      expect(res.amountKobo).toBe("5000");
      expect(res.grossAmountKobo).toBe("5000");
      expect(res.onetoFeeKobo).toBe("125");
      expect(res.korapayPayoutFeeKobo).toBeNull();
      expect(res.netPayoutKobo).toBeNull();
      expect(res.status).toBe("PENDING");
      expect(mockPost).toHaveBeenCalledWith("/cashout/request");
    });

    it("should throw SCHEMA_MISMATCH on invalid response shape", async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          cashout: {
            id: "cash_123",
            // missing amountKobo, etc.
          },
        },
      });

      const promise = requestCashout();
      await expect(promise).rejects.toThrow(ApiError);
      await expect(promise).rejects.toMatchObject({
        code: "SCHEMA_MISMATCH",
      });
    });
  });

  describe("getCashoutStatus", () => {
    it("should return array of cashouts on success", async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          cashouts: [
            {
              id: "cash_123",
              amountKobo: "5000",
              grossAmountKobo: "5000",
              onetoFeeBps: 250,
              onetoFeeKobo: "125",
              korapayPayoutFeeKobo: "25",
              netPayoutKobo: "4850",
              finalPayoutAmountKobo: "4875",
              status: "COMPLETED",
              requestedAt: "2023-10-10T10:00:00.000Z",
            },
          ],
        },
      });

      const res = await getCashoutStatus();
      expect(res).toHaveLength(1);
      expect(res[0]?.id).toBe("cash_123");
      expect(res[0]?.status).toBe("COMPLETED");
      expect(mockGet).toHaveBeenCalledWith("/cashout/status");
    });

    it("should throw SCHEMA_MISMATCH on invalid response shape", async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          cashouts: "not an array",
        },
      });

      const promise = getCashoutStatus();
      await expect(promise).rejects.toThrow(ApiError);
      await expect(promise).rejects.toMatchObject({
        code: "SCHEMA_MISMATCH",
      });
    });
  });
});
