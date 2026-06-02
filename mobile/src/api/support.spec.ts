import type { AxiosInstance } from "axios";
import { ApiError, NetworkError } from "./errors";
import { createSupportTicket } from "./support";

function fakeClient(args: {
  post?: (url: string, body?: unknown) => Promise<unknown>;
}): AxiosInstance {
  return {
    post: (url: string, body?: unknown) =>
      args.post ? args.post(url, body) : Promise.reject(new Error("post not mocked")),
  } as unknown as AxiosInstance;
}

describe("support api", () => {
  it("posts the expected support ticket body", async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        ticketNumber: "SUP-20260530-ABC123",
        status: "OPEN",
      },
    });

    const result = await createSupportTicket(
      {
        category: "ACCOUNT_RECOVERY",
        subject: "Need help moving devices",
        message: "I changed phones and need help activating this new one.",
      },
      fakeClient({ post: (url, body) => post(url, body) }),
    );

    expect(post).toHaveBeenCalledWith("/support/tickets", {
      category: "ACCOUNT_RECOVERY",
      subject: "Need help moving devices",
      message: "I changed phones and need help activating this new one.",
    });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("pin");
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("otp");
    expect(result.status).toBe("OPEN");
  });

  it("returns typed errors for schema mismatches and network failures", async () => {
    const schemaMismatch = createSupportTicket(
      {
        category: "OTHER",
        subject: "General help needed",
        message: "Please help me with a general support question on the app.",
      },
      fakeClient({
        post: () => Promise.resolve({ data: { ok: false } }),
      }),
    );
    const networkFailure = createSupportTicket(
      {
        category: "OTHER",
        subject: "General help needed",
        message: "Please help me with a general support question on the app.",
      },
      fakeClient({
        post: () =>
          Promise.reject({
            isAxiosError: true,
            response: undefined,
          }),
      }),
    );

    await expect(schemaMismatch).rejects.toBeInstanceOf(ApiError);
    await expect(networkFailure).rejects.toBeInstanceOf(NetworkError);
  });
});
