import { shouldClearTokenAfterUnauthorized } from "./unauthorized-policy";

describe("unauthorized token policy", () => {
  it("keeps token when recovery keypair is pending", () => {
    expect(
      shouldClearTokenAfterUnauthorized({
        pendingRecoveryKeypairPresent: true,
      }),
    ).toBe(false);
  });

  it("clears token when no pending recovery keypair exists", () => {
    expect(
      shouldClearTokenAfterUnauthorized({
        pendingRecoveryKeypairPresent: false,
      }),
    ).toBe(true);
  });
});
