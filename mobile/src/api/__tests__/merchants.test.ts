import type { AxiosInstance } from "axios";
import { fetchActiveMerchants } from "../merchants";
import { ApiError, NetworkError } from "../errors";

function fakeClient(opts: {
  get?: (url: string) => Promise<{ data: unknown }>;
}): AxiosInstance {
  return {
    get: opts.get ?? (() => Promise.reject(new Error("get not configured"))),
  } as unknown as AxiosInstance;
}

describe("fetchActiveMerchants", () => {
  it("fetches and parses merchants list", async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        merchants: [
          { id: "u_aaaaaaaaaaaaaaaa", label: "Bookshop" },
          { id: "u_bbbbbbbbbbbbbbbb", label: "Campus Cafe" },
        ],
      },
    });

    const merchants = await fetchActiveMerchants(fakeClient({ get }));

    expect(get).toHaveBeenCalledWith("/merchants/list");
    expect(merchants).toHaveLength(2);
    expect(merchants[0]!.label).toBe("Bookshop");
  });

  it("throws ApiError on schema mismatch", async () => {
    const client = fakeClient({
      get: () => Promise.resolve({ data: { merchants: [{ id: 1 }] } }),
    });

    await expect(fetchActiveMerchants(client)).rejects.toThrow(ApiError);
  });

  it("converts transport failures to typed network errors", async () => {
    const client = fakeClient({
      get: () =>
        Promise.reject({ isAxiosError: true, response: undefined }),
    });

    await expect(fetchActiveMerchants(client)).rejects.toThrow(NetworkError);
  });
});

