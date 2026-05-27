import { createApprovalScanLock } from "./approval-scan-lock";

describe("approval scan lock", () => {
  it("allows only one scan attempt until reset", () => {
    const lock = createApprovalScanLock();

    expect(lock.tryLock("qr-1")).toBe(true);
    expect(lock.currentQr()).toBe("qr-1");
    expect(lock.isLocked()).toBe(true);

    expect(lock.tryLock("qr-1")).toBe(false);
    expect(lock.tryLock("qr-2")).toBe(false);
    expect(lock.currentQr()).toBe("qr-1");

    lock.reset();

    expect(lock.isLocked()).toBe(false);
    expect(lock.currentQr()).toBeNull();
    expect(lock.tryLock("qr-2")).toBe(true);
    expect(lock.currentQr()).toBe("qr-2");
  });
});
