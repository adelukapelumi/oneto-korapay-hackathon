import { initiateTopup } from "../topup";
import { apiClient } from "../client";
import { ApiError } from "../errors";

jest.mock("../client");

describe("initiateTopup", () => {
  const mockPost = apiClient.post as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return reference and paymentUrl on success", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        reference: "top_123",
        paymentUrl: "https://checkout.korapay.com/pay/123",
      },
    });

    const res = await initiateTopup(50000);
    expect(res.reference).toBe("top_123");
    expect(res.paymentUrl).toBe("https://checkout.korapay.com/pay/123");
    expect(mockPost).toHaveBeenCalledWith("/topup/korapay/initiate", {
      amountKobo: 50000,
    });
  });

  it("should throw SCHEMA_MISMATCH on invalid response shape", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        reference: "top_123",
        // missing paymentUrl
      },
    });

    const promise = initiateTopup(50000);
    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    });
  });

  it("should propagate network errors", async () => {
    mockPost.mockRejectedValueOnce(new Error("Network Error"));
    await expect(initiateTopup(50000)).rejects.toThrow("Network Error");
  });
});
