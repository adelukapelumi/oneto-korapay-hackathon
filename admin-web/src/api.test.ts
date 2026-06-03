import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminSession, getNgBanks } from "./api";

describe("admin api auth handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not trigger auth failure for bank list gateway errors", async () => {
    const onAuthFailure = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "korapay_bank_list_unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getNgBanks(onAuthFailure)).rejects.toThrow(
      "korapay_bank_list_unavailable",
    );
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("triggers auth failure when admin session validation returns 401", async () => {
    const onAuthFailure = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getAdminSession(onAuthFailure)).rejects.toThrow(
      "Your session has expired. Please log in again.",
    );
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });
});
