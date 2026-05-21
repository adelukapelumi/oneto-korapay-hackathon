// In-memory expo-secure-store mock with a __reset hook. The shared
// jest.setup.js mock would also work, but local control here makes the
// contract explicit.
jest.mock("expo-secure-store", () => {
  const memory = new Map<string, string>();
  return {
    getItemAsync: jest.fn(
      (key: string): Promise<string | null> =>
        Promise.resolve(memory.has(key) ? (memory.get(key) ?? null) : null),
    ),
    setItemAsync: jest.fn((key: string, value: string): Promise<void> => {
      memory.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string): Promise<void> => {
      memory.delete(key);
      return Promise.resolve();
    }),
    __reset: () => memory.clear(),
  };
});

import * as SecureStore from "expo-secure-store";
import {
  ATTEMPTS_BEFORE_LOCKOUT,
  ATTEMPTS_BEFORE_WIPE,
  LOCKOUT_DURATION_MS,
  PinIncorrectError,
  PinLockedError,
  changePinAndReencrypt,
  clearAttempts,
  clearPendingRecoveryAttempts,
  getAttemptState,
  getPendingRecoveryAttemptState,
  getPendingRecoveryPublicKey,
  hasKeypair,
  hasPendingRecoveryKeypair,
  loadAndDecryptKeypair,
  loadAndDecryptPendingRecoveryKeypair,
  moveKeypairToPendingRecovery,
  promotePendingRecoveryKeypair,
  recordWrongAttempt,
  recordPendingRecoveryWrongAttempt,
  saveNewKeypair,
  savePendingRecoveryKeypair,
  wipeKeypair,
  wipePendingRecoveryKeypair,
} from "./keypair-store";

const reset = (SecureStore as unknown as { __reset: () => void }).__reset;

jest.setTimeout(60_000);

const samplePrivateKey = (): Uint8Array => {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i + 1;
  return k;
};

const samplePublicKey =
  "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("keypair-store", () => {
  beforeEach(() => reset());

  describe("hasKeypair / saveNewKeypair", () => {
    it("returns false on a fresh device", async () => {
      await expect(hasKeypair()).resolves.toBe(false);
    });

    it("returns true after saveNewKeypair", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");
      await expect(hasKeypair()).resolves.toBe(true);
    });

    it("rejects a non-32-byte private key", async () => {
      await expect(
        saveNewKeypair(new Uint8Array(31), samplePublicKey, "123456"),
      ).rejects.toThrow();
    });
  });

  describe("pending recovery slot", () => {
    it("stores and decrypts a pending recovery keypair separately from the active slot", async () => {
      const pk = samplePrivateKey();
      await savePendingRecoveryKeypair(pk, samplePublicKey, "123456");

      await expect(hasKeypair()).resolves.toBe(false);
      await expect(hasPendingRecoveryKeypair()).resolves.toBe(true);
      await expect(getPendingRecoveryPublicKey()).resolves.toBe(samplePublicKey);

      const loaded = await loadAndDecryptPendingRecoveryKeypair("123456");
      expect(Array.from(loaded.privateKey)).toEqual(Array.from(pk));
      expect(loaded.publicKey).toBe(samplePublicKey);
    });

    it("moves an active keypair into the pending recovery slot", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");

      await moveKeypairToPendingRecovery();

      await expect(hasKeypair()).resolves.toBe(false);
      await expect(hasPendingRecoveryKeypair()).resolves.toBe(true);
      await expect(getPendingRecoveryPublicKey()).resolves.toBe(samplePublicKey);
    });

    it("promotes a pending recovery keypair into the active slot", async () => {
      const pk = samplePrivateKey();
      await savePendingRecoveryKeypair(pk, samplePublicKey, "123456");

      await promotePendingRecoveryKeypair();

      await expect(hasPendingRecoveryKeypair()).resolves.toBe(false);
      await expect(hasKeypair()).resolves.toBe(true);

      const loaded = await loadAndDecryptKeypair("123456");
      expect(Array.from(loaded.privateKey)).toEqual(Array.from(pk));
      expect(loaded.publicKey).toBe(samplePublicKey);
    });
  });

  describe("loadAndDecryptKeypair", () => {
    it("round-trips with the correct PIN", async () => {
      const pk = samplePrivateKey();
      await saveNewKeypair(pk, samplePublicKey, "123456");
      const loaded = await loadAndDecryptKeypair("123456");
      expect(Array.from(loaded.privateKey)).toEqual(Array.from(pk));
      expect(loaded.publicKey).toBe(samplePublicKey);
    });

    it("throws PinIncorrectError on wrong PIN", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");
      await expect(loadAndDecryptKeypair("999999")).rejects.toBeInstanceOf(
        PinIncorrectError,
      );
    });

    it("throws when no keypair is stored", async () => {
      await expect(loadAndDecryptKeypair("123456")).rejects.toThrow(
        /No keypair stored/,
      );
    });

    it("clears wrong-attempt counter on successful unlock (caller responsibility)", async () => {
      // Helper assertion: clearAttempts after a successful unlock zeroes state.
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");
      await recordWrongAttempt();
      await recordWrongAttempt();
      const before = await getAttemptState();
      expect(before.wrongAttempts).toBe(2);
      await clearAttempts();
      const after = await getAttemptState();
      expect(after.wrongAttempts).toBe(0);
    });
  });

  describe("attempt counter and lockout", () => {
    it("starts at zero", async () => {
      const state = await getAttemptState();
      expect(state.wrongAttempts).toBe(0);
      expect(state.isLocked).toBe(false);
      expect(state.lockedUntilMs).toBeNull();
    });

    it("locks after 5 wrong attempts", async () => {
      const now = 1_000_000;
      for (let i = 0; i < ATTEMPTS_BEFORE_LOCKOUT - 1; i++) {
        const r = await recordWrongAttempt(now);
        expect(r.nowLocked).toBe(false);
      }
      const r5 = await recordWrongAttempt(now);
      expect(r5.nowLocked).toBe(true);
      expect(r5.lockedUntilMs).toBe(now + LOCKOUT_DURATION_MS);
    });

    it("loadAndDecryptKeypair throws PinLockedError while locked", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");
      // Pin Date.now() so the lock written by recordWrongAttempt is still
      // in the future when loadAndDecryptKeypair checks state.
      const now = 1_000_000;
      const dateNow = jest.spyOn(Date, "now").mockReturnValue(now);
      try {
        for (let i = 0; i < ATTEMPTS_BEFORE_LOCKOUT; i++) {
          await recordWrongAttempt(now);
        }
        await expect(loadAndDecryptKeypair("123456")).rejects.toBeInstanceOf(
          PinLockedError,
        );
      } finally {
        dateNow.mockRestore();
      }
    });

    it("unlocks after the lock duration passes", async () => {
      const now = 1_000_000;
      for (let i = 0; i < ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await recordWrongAttempt(now);
      }
      const stillLocked = await getAttemptState(now + 1);
      expect(stillLocked.isLocked).toBe(true);
      const afterLock = await getAttemptState(now + LOCKOUT_DURATION_MS + 1);
      expect(afterLock.isLocked).toBe(false);
      // Counter is preserved across lock so we can still wipe at 10 total.
      expect(afterLock.wrongAttempts).toBe(ATTEMPTS_BEFORE_LOCKOUT);
    });

    it("wipes the keypair after 10 total wrong attempts", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "123456");
      const now = 1_000_000;
      // First 5 → lock
      for (let i = 0; i < ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await recordWrongAttempt(now);
      }
      // 4 more after lock expiry → still no wipe
      for (let i = 0; i < ATTEMPTS_BEFORE_WIPE - ATTEMPTS_BEFORE_LOCKOUT - 1; i++) {
        const r = await recordWrongAttempt(now + LOCKOUT_DURATION_MS + 1);
        expect(r.willWipe).toBe(false);
      }
      // 10th → wipe
      const r10 = await recordWrongAttempt(now + LOCKOUT_DURATION_MS + 1);
      expect(r10.willWipe).toBe(true);
      await expect(hasKeypair()).resolves.toBe(false);
    });

    it("clearAttempts resets the counter (called on successful unlock)", async () => {
      await recordWrongAttempt();
      await recordWrongAttempt();
      await clearAttempts();
      const state = await getAttemptState();
      expect(state.wrongAttempts).toBe(0);
    });
  });

  describe("pending recovery attempts", () => {
    it("tracks pending recovery PIN attempts separately", async () => {
      await savePendingRecoveryKeypair(samplePrivateKey(), samplePublicKey, "123456");

      await recordPendingRecoveryWrongAttempt();
      await recordPendingRecoveryWrongAttempt();
      const before = await getPendingRecoveryAttemptState();
      expect(before.wrongAttempts).toBe(2);

      await clearPendingRecoveryAttempts();
      const after = await getPendingRecoveryAttemptState();
      expect(after.wrongAttempts).toBe(0);
    });

    it("wipes the pending recovery slot after too many wrong attempts", async () => {
      await savePendingRecoveryKeypair(samplePrivateKey(), samplePublicKey, "123456");
      const now = 2_000_000;

      for (let i = 0; i < ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await recordPendingRecoveryWrongAttempt(now);
      }
      for (let i = 0; i < ATTEMPTS_BEFORE_WIPE - ATTEMPTS_BEFORE_LOCKOUT - 1; i++) {
        await recordPendingRecoveryWrongAttempt(now + LOCKOUT_DURATION_MS + 1);
      }

      const wipeResult = await recordPendingRecoveryWrongAttempt(
        now + LOCKOUT_DURATION_MS + 1,
      );

      expect(wipeResult.willWipe).toBe(true);
      await expect(hasPendingRecoveryKeypair()).resolves.toBe(false);
    });
  });

  describe("changePinAndReencrypt", () => {
    it("rejects a wrong old PIN", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "111111");
      await expect(
        changePinAndReencrypt("000000", "222222"),
      ).rejects.toBeInstanceOf(PinIncorrectError);
    });

    it("makes the keypair recoverable with the new PIN only", async () => {
      const pk = samplePrivateKey();
      await saveNewKeypair(pk, samplePublicKey, "111111");
      await changePinAndReencrypt("111111", "222222");

      // Old PIN no longer works.
      await expect(loadAndDecryptKeypair("111111")).rejects.toBeInstanceOf(
        PinIncorrectError,
      );
      // New PIN works and returns the same private key.
      const loaded = await loadAndDecryptKeypair("222222");
      expect(Array.from(loaded.privateKey)).toEqual(Array.from(pk));
    });
  });

  describe("wipeKeypair", () => {
    it("removes all stored keypair material", async () => {
      await saveNewKeypair(samplePrivateKey(), samplePublicKey, "111111");
      await recordWrongAttempt();
      await wipeKeypair();
      await expect(hasKeypair()).resolves.toBe(false);
      const state = await getAttemptState();
      expect(state.wrongAttempts).toBe(0);
    });
  });

  describe("wipePendingRecoveryKeypair", () => {
    it("removes all pending recovery key material", async () => {
      await savePendingRecoveryKeypair(samplePrivateKey(), samplePublicKey, "111111");
      await recordPendingRecoveryWrongAttempt();
      await wipePendingRecoveryKeypair();
      await expect(hasPendingRecoveryKeypair()).resolves.toBe(false);
      const state = await getPendingRecoveryAttemptState();
      expect(state.wrongAttempts).toBe(0);
    });
  });
});
