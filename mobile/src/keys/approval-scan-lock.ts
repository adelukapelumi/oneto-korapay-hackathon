export interface ApprovalScanLock {
  tryLock: (rawQr: string) => boolean;
  reset: () => void;
  isLocked: () => boolean;
  currentQr: () => string | null;
}

export function createApprovalScanLock(): ApprovalScanLock {
  let locked = false;
  let activeQr: string | null = null;

  return {
    tryLock(rawQr: string): boolean {
      if (locked) {
        return false;
      }
      locked = true;
      activeQr = rawQr;
      return true;
    },
    reset(): void {
      locked = false;
      activeQr = null;
    },
    isLocked(): boolean {
      return locked;
    },
    currentQr(): string | null {
      return activeQr;
    },
  };
}
