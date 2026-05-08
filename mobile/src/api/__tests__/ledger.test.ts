import { fetchLedger } from "../ledger";
import { apiClient } from "../client";
import { ApiError } from "../errors";

jest.mock("../client", () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

describe("fetchLedger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns parsed ledger entries successfully", async () => {
    const mockData = {
      entries: [
        {
          id: "entry_1",
          transactionId: "tx_1",
          type: "DEBIT",
          amountKobo: "5000",
          balanceAfterKobo: "10000",
          description: "Payment",
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: "cursor_123",
    };

    (apiClient.get as jest.Mock).mockResolvedValueOnce({ data: mockData });

    const result = await fetchLedger();

    expect(apiClient.get).toHaveBeenCalledWith("/me/ledger", { params: { limit: "20" } });
    expect(result).toEqual(mockData);
  });

  it("handles empty entries and null nextCursor", async () => {
    const mockData = { entries: [], nextCursor: null };
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ data: mockData });

    const result = await fetchLedger();

    expect(result).toEqual({ entries: [], nextCursor: null });
  });

  it("throws ApiError SCHEMA_MISMATCH on invalid response shape", async () => {
    const mockData = { entries: [{ invalid: "data" }] };
    (apiClient.get as jest.Mock).mockResolvedValue({ data: mockData });

    await expect(fetchLedger()).rejects.toThrow(ApiError);
    await expect(fetchLedger()).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
  });

  it("passes cursor as query param when provided", async () => {
    const mockData = { entries: [], nextCursor: null };
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ data: mockData });

    await fetchLedger("test_cursor", 50);

    expect(apiClient.get).toHaveBeenCalledWith("/me/ledger", {
      params: { limit: "50", cursor: "test_cursor" },
    });
  });
});
