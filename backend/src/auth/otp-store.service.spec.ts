import {
  OtpStoreService,
  OtpRateLimitExceededError,
} from "./otp-store.service";
import { E164 } from "../common/phone";

// Helper: create a branded phone without going through libphonenumber
// parsing. In real code we always go through normalizePhone, but for
// unit tests of OtpStoreService in isolation, we fake the brand.
const phone = (s: string): E164 => s as unknown as E164;

describe("OtpStoreService", () => {
  let store: OtpStoreService;
  const ALICE = phone("+2348011111111");
  const BOB = phone("+2348022222222");

  beforeEach(() => {
    store = new OtpStoreService();
  });

  // ------- happy path -------

  describe("happy path", () => {
    it("saves and verifies a correct OTP", async () => {
      await store.saveOtp(ALICE, "123456");
      const result = await store.verifyOtp(ALICE, "123456");
      expect(result).toBe(true);
    });

    it("burns the OTP after successful verification", async () => {
      await store.saveOtp(ALICE, "123456");
      expect(store._sizeForTests()).toBe(1);

      await store.verifyOtp(ALICE, "123456");

      expect(store._sizeForTests()).toBe(0);
    });

    it("rejects an already-consumed OTP on reuse", async () => {
      await store.saveOtp(ALICE, "123456");
      const first = await store.verifyOtp(ALICE, "123456");
      const second = await store.verifyOtp(ALICE, "123456");

      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  // ------- wrong OTP handling -------

  describe("wrong OTP", () => {
    it("returns false for a wrong OTP", async () => {
      await store.saveOtp(ALICE, "123456");
      const result = await store.verifyOtp(ALICE, "999999");
      expect(result).toBe(false);
    });

    it("keeps the record alive after one wrong attempt", async () => {
      await store.saveOtp(ALICE, "123456");
      await store.verifyOtp(ALICE, "999999");
      expect(store._sizeForTests()).toBe(1);
    });

    it("allows a correct attempt after a wrong one (within 3 tries)", async () => {
      await store.saveOtp(ALICE, "123456");
      await store.verifyOtp(ALICE, "000000"); // 1st wrong
      await store.verifyOtp(ALICE, "000001"); // 2nd wrong
      const result = await store.verifyOtp(ALICE, "123456"); // correct on 3rd
      expect(result).toBe(true);
    });
  });

  // ------- brute force protection -------

  describe("brute force protection", () => {
    it("burns the OTP after maxFailedAttempts wrong attempts", async () => {
      await store.saveOtp(ALICE, "123456");

      await store.verifyOtp(ALICE, "000000");
      await store.verifyOtp(ALICE, "000001");
      await store.verifyOtp(ALICE, "000002"); // 3rd wrong → burn

      expect(store._sizeForTests()).toBe(0);
    });

    it("rejects the correct OTP if brute-force burn already triggered", async () => {
      await store.saveOtp(ALICE, "123456");

      await store.verifyOtp(ALICE, "000000");
      await store.verifyOtp(ALICE, "000001");
      await store.verifyOtp(ALICE, "000002"); // burn

      const result = await store.verifyOtp(ALICE, "123456"); // real code
      expect(result).toBe(false);
    });

    it("respects a custom maxFailedAttempts configuration", async () => {
      const strict = new OtpStoreService({ maxFailedAttempts: 2 });
      await strict.saveOtp(ALICE, "123456");

      await strict.verifyOtp(ALICE, "000000");
      await strict.verifyOtp(ALICE, "000001"); // 2nd wrong → burn at limit 2

      expect(strict._sizeForTests()).toBe(0);
    });
  });

  // ------- expiry -------

  describe("expiry", () => {
    it("rejects an OTP that has expired based on nowMs", async () => {
      const t0 = 1_000_000;
      await store.saveOtp(ALICE, "123456", t0);

      // 5 minutes + 1 ms later
      const afterExpiry = t0 + 5 * 60 * 1000 + 1;
      const result = await store.verifyOtp(ALICE, "123456", afterExpiry);

      expect(result).toBe(false);
    });

    it("burns an expired record on verify attempt", async () => {
      const t0 = 1_000_000;
      await store.saveOtp(ALICE, "123456", t0);
      expect(store._sizeForTests()).toBe(1);

      await store.verifyOtp(ALICE, "123456", t0 + 10 * 60 * 1000);

      expect(store._sizeForTests()).toBe(0);
    });

    it("accepts an OTP within the TTL window", async () => {
      const t0 = 1_000_000;
      await store.saveOtp(ALICE, "123456", t0);

      const justInTime = t0 + 4 * 60 * 1000 + 59 * 1000;
      const result = await store.verifyOtp(ALICE, "123456", justInTime);

      expect(result).toBe(true);
    });

    it("respects a custom ttlMs configuration", async () => {
      const shortLived = new OtpStoreService({ ttlMs: 1000 }); // 1 second
      const t0 = 1_000_000;
      await shortLived.saveOtp(ALICE, "123456", t0);

      const tooLate = t0 + 2000;
      const result = await shortLived.verifyOtp(ALICE, "123456", tooLate);

      expect(result).toBe(false);
    });
  });

  // ------- isolation between phones -------

  describe("per-phone isolation", () => {
    it("keeps Alice's and Bob's OTPs separate", async () => {
      await store.saveOtp(ALICE, "111111");
      await store.saveOtp(BOB, "222222");

      const aliceWithBobCode = await store.verifyOtp(ALICE, "222222");
      const bobWithAliceCode = await store.verifyOtp(BOB, "111111");

      expect(aliceWithBobCode).toBe(false);
      expect(bobWithAliceCode).toBe(false);
    });

    it("does not burn Alice's OTP when Bob fails 3 times", async () => {
      await store.saveOtp(ALICE, "111111");
      await store.saveOtp(BOB, "222222");

      await store.verifyOtp(BOB, "000000");
      await store.verifyOtp(BOB, "000001");
      await store.verifyOtp(BOB, "000002"); // Bob burned

      const aliceStillValid = await store.verifyOtp(ALICE, "111111");
      expect(aliceStillValid).toBe(true);
    });
  });

  // ------- rate limiting (the bit Gemini got wrong before) -------

  describe("request rate limiting", () => {
    it("allows up to maxRequestsPerWindow in the window", () => {
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) {
        expect(() => store.checkAndRecordRequest(ALICE, t0 + i)).not.toThrow();
      }
    });

    it("rejects the 6th request inside the window", () => {
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) {
        store.checkAndRecordRequest(ALICE, t0 + i);
      }
      expect(() => store.checkAndRecordRequest(ALICE, t0 + 6)).toThrow(
        OtpRateLimitExceededError,
      );
    });

    it("provides a retryAfter hint when rejecting", () => {
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) {
        store.checkAndRecordRequest(ALICE, t0 + i);
      }
      try {
        store.checkAndRecordRequest(ALICE, t0 + 6);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OtpRateLimitExceededError);
        const e = err as OtpRateLimitExceededError;
        expect(e.retryAfterMs).toBeGreaterThan(0);
        expect(e.retryAfterMs).toBeLessThanOrEqual(60_000);
      }
    });

    it("allows a new request after the window has passed", () => {
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) {
        store.checkAndRecordRequest(ALICE, t0 + i);
      }

      const afterWindow = t0 + 60_001;
      expect(() => store.checkAndRecordRequest(ALICE, afterWindow)).not.toThrow();
    });

    it("tracks rate limits per phone separately (no IP-rotation bypass equivalent)", () => {
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) {
        store.checkAndRecordRequest(ALICE, t0 + i);
      }

      // Bob should still be able to request even though Alice is rate-limited.
      expect(() => store.checkAndRecordRequest(BOB, t0 + 6)).not.toThrow();

      // Alice is still blocked.
      expect(() => store.checkAndRecordRequest(ALICE, t0 + 6)).toThrow(
        OtpRateLimitExceededError,
      );
    });

    it("respects custom maxRequestsPerWindow", () => {
      const strict = new OtpStoreService({ maxRequestsPerWindow: 2 });
      const t0 = 1_000_000;

      strict.checkAndRecordRequest(ALICE, t0);
      strict.checkAndRecordRequest(ALICE, t0 + 1);

      expect(() => strict.checkAndRecordRequest(ALICE, t0 + 2)).toThrow(
        OtpRateLimitExceededError,
      );
    });
  });

  // ------- storage is hashed, not plaintext -------

  describe("storage format", () => {
    it("does not store the OTP in plaintext", async () => {
      await store.saveOtp(ALICE, "123456");

      // Reach into the private Map via a cast. This is test-only introspection;
      // production code should never do this.
      const otpsMap = (store as unknown as {
        otps: Map<string, { hash: string }>;
      }).otps;

      const record = otpsMap.get(ALICE);
      expect(record).toBeDefined();
      expect(record!.hash).not.toContain("123456");
      expect(record!.hash.startsWith("$argon2")).toBe(true);
    });
  });
});