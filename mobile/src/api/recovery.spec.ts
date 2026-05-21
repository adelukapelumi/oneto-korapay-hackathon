import type { AxiosInstance } from "axios";
import {
  cancelRecoveryRequest,
  createRecoveryRequest,
  getRecoveryStatus,
} from "./recovery";
import { ApiError, NetworkError } from "./errors";

function fakeClient(args: {
  post?: (url: string, body?: unknown) => Promise<unknown>;
  get?: (url: string) => Promise<unknown>;
}): AxiosInstance {
  return {
    post: (url: string, body?: unknown) =>
      args.post ? args.post(url, body) : Promise.reject(new Error("post not mocked")),
    get: (url: string) =>
      args.get ? args.get(url) : Promise.reject(new Error("get not mocked")),
  } as unknown as AxiosInstance;
}

const sampleRequest = {
  id: "recovery_123",
  userId: "u_123",
  oldKeyId: "key_old",
  requestedNewPublicKey:
    "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  status: "PENDING",
  riskType: "LOST_DEVICE",
  reason: "LOST_PHONE",
  userNotes: "Phone stopped turning on",
  approximateBalanceKobo: "150000",
  lastMerchantText: "Cafe One",
  lastTopupAmountKobo: "50000",
  reviewedAt: null,
  decisionNotes: null,
  createdAt: "2026-05-21T10:00:00.000Z",
  updatedAt: "2026-05-21T10:00:00.000Z",
} as const;

describe("recovery api", () => {
  it("createRecoveryRequest sends the expected request body", async () => {
    const post = jest.fn().mockResolvedValue({ data: sampleRequest });

    await createRecoveryRequest(
      {
        requestedNewPublicKey: sampleRequest.requestedNewPublicKey,
        riskType: "LOST_DEVICE",
        reason: "DAMAGED_PHONE",
        approximateBalanceKobo: 123400,
        lastMerchantText: "Books and Bites",
        lastTopupAmountKobo: 25000,
        userNotes: "Screen cracked after a fall",
      },
      fakeClient({ post: (url, body) => post(url, body) }),
    );

    expect(post).toHaveBeenCalledWith("/recovery/request", {
      requestedNewPublicKey: sampleRequest.requestedNewPublicKey,
      riskType: "LOST_DEVICE",
      reason: "DAMAGED_PHONE",
      approximateBalanceKobo: 123400,
      lastMerchantText: "Books and Bites",
      lastTopupAmountKobo: 25000,
      userNotes: "Screen cracked after a fall",
    });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("pin");
  });

  it("getRecoveryStatus parses a pending request", async () => {
    const result = await getRecoveryStatus(
      fakeClient({
        get: () => Promise.resolve({ data: { recoveryRequest: sampleRequest } }),
      }),
    );

    expect(result?.status).toBe("PENDING");
    expect(result?.riskType).toBe("LOST_DEVICE");
  });

  it("getRecoveryStatus parses approved, rejected, and null states", async () => {
    const approved = await getRecoveryStatus(
      fakeClient({
        get: () =>
          Promise.resolve({
            data: {
              recoveryRequest: {
                ...sampleRequest,
                status: "APPROVED",
                reviewedAt: "2026-05-22T09:00:00.000Z",
              },
            },
          }),
      }),
    );
    const rejected = await getRecoveryStatus(
      fakeClient({
        get: () =>
          Promise.resolve({
            data: {
              recoveryRequest: {
                ...sampleRequest,
                status: "REJECTED",
                reviewedAt: "2026-05-22T10:00:00.000Z",
                decisionNotes: "Need more details",
              },
            },
          }),
      }),
    );
    const none = await getRecoveryStatus(
      fakeClient({
        get: () => Promise.resolve({ data: { recoveryRequest: null } }),
      }),
    );

    expect(approved?.status).toBe("APPROVED");
    expect(rejected?.status).toBe("REJECTED");
    expect(none).toBeNull();
  });

  it("cancelRecoveryRequest calls the correct endpoint", async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        ...sampleRequest,
        status: "CANCELLED",
      },
    });

    const result = await cancelRecoveryRequest(
      "recovery_123",
      fakeClient({ post: (url, body) => post(url, body) }),
    );

    expect(post).toHaveBeenCalledWith("/recovery/recovery_123/cancel", undefined);
    expect(result.status).toBe("CANCELLED");
  });

  it("returns typed ApiError and NetworkError failures consistently", async () => {
    const schemaMismatch = createRecoveryRequest(
      {
        requestedNewPublicKey: sampleRequest.requestedNewPublicKey,
        riskType: "COMPROMISED_DEVICE",
        reason: "STOLEN_PHONE",
      },
      fakeClient({
        post: () => Promise.resolve({ data: { ok: false } }),
      }),
    );
    const networkFailure = getRecoveryStatus(
      fakeClient({
        get: () =>
          Promise.reject({
            isAxiosError: true,
            response: undefined,
          }),
      }),
    );

    await expect(schemaMismatch).rejects.toBeInstanceOf(ApiError);
    await expect(schemaMismatch).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    });
    await expect(networkFailure).rejects.toBeInstanceOf(NetworkError);
  });
});
