import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { E164 } from "../common/phone";
import { RedisOtpStoreService } from "./redis-otp-store.service";
import { OtpRateLimitExceededError } from "./otp-store.service";

const target = (value: string): E164 => value as unknown as E164;

class FakeRedis {
  private readonly strings = new Map<string, string>();
  private readonly hashes = new Map<string, Record<string, string>>();
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private readonly expiries = new Map<string, number>();

  async connect(): Promise<void> {}

  async ping(): Promise<string> {
    return "PONG";
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }

  disconnect(): void {}

  async set(key: string, value: string, ...args: Array<string | number>): Promise<"OK" | null> {
    this.cleanupExpiredKey(key);

    const nx = args.includes("NX");
    if (nx && this.hasKey(key)) {
      return null;
    }

    const pxIndex = args.findIndex((arg) => arg === "PX");
    if (pxIndex >= 0) {
      this.expiries.set(key, Date.now() + Number(args[pxIndex + 1]));
    } else {
      this.expiries.delete(key);
    }

    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.cleanupExpiredKey(key);
    return this.strings.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;

    for (const key of keys) {
      if (this.deleteKey(key)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async hset(key: string, ...pairs: Array<string | number>): Promise<number> {
    const record = this.hashes.get(key) ?? {};
    for (let index = 0; index < pairs.length; index += 2) {
      record[String(pairs[index])] = String(pairs[index + 1]);
    }

    this.hashes.set(key, record);
    return pairs.length / 2;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.cleanupExpiredKey(key);
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async pexpire(key: string, milliseconds: number | string): Promise<number> {
    if (!this.hasKey(key)) {
      return 0;
    }

    this.expiries.set(key, Date.now() + Number(milliseconds));
    return 1;
  }

  async eval(
    script: string,
    numKeys: number | string,
    ...args: Array<string | number>
  ): Promise<unknown> {
    const keyCount = Number(numKeys);
    const keys = args.slice(0, keyCount).map(String);
    const values = args.slice(keyCount);

    if (script.includes("ZREMRANGEBYSCORE")) {
      return this.runRateLimitScript(keys[0]!, values);
    }

    if (script.includes('currentHash ~= expectedHash')) {
      return this.runFinalizeVerifyScript(keys[0]!, values);
    }

    if (script.includes('redis.call("GET", lockKey) == expectedToken')) {
      return this.runReleaseLockScript(keys[0]!, values);
    }

    throw new Error("Unexpected Redis script in test double");
  }

  getAllKeysForTests(): string[] {
    return [
      ...this.strings.keys(),
      ...this.hashes.keys(),
      ...this.sortedSets.keys(),
    ];
  }

  getHashForTests(key: string): Record<string, string> | undefined {
    return this.hashes.get(key);
  }

  private runRateLimitScript(
    key: string,
    args: Array<string | number>,
  ): [number, number] {
    const nowMs = Number(args[0]);
    const windowMs = Number(args[1]);
    const maxRequests = Number(args[2]);
    const requestMember = String(args[3]);
    const windowStart = nowMs - windowMs;

    const set = this.sortedSets.get(key) ?? new Map<string, number>();
    for (const [member, score] of set.entries()) {
      if (score <= windowStart) {
        set.delete(member);
      }
    }

    if (set.size >= maxRequests) {
      const oldestScore = Math.min(...set.values());
      return [0, Math.max(oldestScore + windowMs - nowMs, 0)];
    }

    set.set(requestMember, nowMs);
    this.sortedSets.set(key, set);
    this.expiries.set(key, Date.now() + windowMs);
    return [1, 0];
  }

  private runFinalizeVerifyScript(
    recordKey: string,
    args: Array<string | number>,
  ): [number, number] {
    const expectedHash = String(args[0]);
    const isValid = String(args[1]);
    const maxFailedAttempts = Number(args[2]);
    const record = this.hashes.get(recordKey);

    if (!record) {
      return [0, 0];
    }

    if (record.hash !== expectedHash) {
      return [-2, 0];
    }

    if (isValid === "1") {
      this.deleteKey(recordKey);
      return [1, 0];
    }

    const failedAttempts = Number(record.failedAttempts ?? "0") + 1;
    if (failedAttempts >= maxFailedAttempts) {
      this.deleteKey(recordKey);
      return [-1, failedAttempts];
    }

    record.failedAttempts = String(failedAttempts);
    this.hashes.set(recordKey, record);
    return [2, failedAttempts];
  }

  private async runReleaseLockScript(
    lockKey: string,
    args: Array<string | number>,
  ): Promise<number> {
    const expectedToken = String(args[0]);
    const currentValue = await this.get(lockKey);

    if (currentValue === expectedToken) {
      return this.del(lockKey);
    }

    return 0;
  }

  private cleanupExpiredKey(key: string): void {
    const expiresAt = this.expiries.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.deleteKey(key);
    }
  }

  private hasKey(key: string): boolean {
    this.cleanupExpiredKey(key);
    return (
      this.strings.has(key) ||
      this.hashes.has(key) ||
      this.sortedSets.has(key)
    );
  }

  private deleteKey(key: string): boolean {
    const deleted =
      this.strings.delete(key) ||
      this.hashes.delete(key) ||
      this.sortedSets.delete(key);

    this.expiries.delete(key);
    return deleted;
  }
}

describe("RedisOtpStoreService", () => {
  const jwtSecret = "12345678901234567890123456789012";
  const ALICE = target("alice@stu.cu.edu.ng");
  const ADMIN_ALICE = target("admin:alice@stu.cu.edu.ng");

  const makeStore = (redis: FakeRedis) => {
    const configService = {
      get: (key: string) => (key === "JWT_SECRET" ? jwtSecret : undefined),
    } as ConfigService;

    return new RedisOtpStoreService(configService, redis as unknown as Redis);
  };

  it("preserves an OTP across service instance recreation", async () => {
    const redis = new FakeRedis();
    const storeOne = makeStore(redis);
    const storeTwo = makeStore(redis);

    await storeOne.saveOtp(ALICE, "123456", 1_000_000);
    await expect(storeTwo.verifyOtp(ALICE, "123456", 1_000_500)).resolves.toBe(true);
  });

  it("preserves failed attempt counts across service instance recreation", async () => {
    const redis = new FakeRedis();
    const storeOne = makeStore(redis);
    const storeTwo = makeStore(redis);

    await storeOne.saveOtp(ALICE, "123456", 1_000_000);
    await expect(storeOne.verifyOtp(ALICE, "000000", 1_000_100)).resolves.toBe(false);
    await expect(storeTwo.verifyOtp(ALICE, "000001", 1_000_200)).resolves.toBe(false);
    await expect(storeTwo.verifyOtp(ALICE, "123456", 1_000_300)).resolves.toBe(true);
  });

  it("preserves OTP request throttling across service instance recreation", async () => {
    const redis = new FakeRedis();
    const storeOne = makeStore(redis);
    const storeTwo = makeStore(redis);
    const t0 = 1_000_000;

    for (let index = 0; index < 3; index += 1) {
      await expect(storeOne.checkAndRecordRequest(ALICE, t0 + index)).resolves.toBeUndefined();
    }

    for (let index = 3; index < 5; index += 1) {
      await expect(storeTwo.checkAndRecordRequest(ALICE, t0 + index)).resolves.toBeUndefined();
    }

    await expect(storeTwo.checkAndRecordRequest(ALICE, t0 + 6)).rejects.toBeInstanceOf(
      OtpRateLimitExceededError,
    );
  });

  it("burns the OTP after successful verification", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "123456", 1_000_000);
    await expect(store.verifyOtp(ALICE, "123456", 1_000_100)).resolves.toBe(true);
    await expect(store.verifyOtp(ALICE, "123456", 1_000_200)).resolves.toBe(false);
  });

  it("burns the OTP after the third wrong attempt", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "123456", 1_000_000);
    await expect(store.verifyOtp(ALICE, "000000", 1_000_100)).resolves.toBe(false);
    await expect(store.verifyOtp(ALICE, "000001", 1_000_200)).resolves.toBe(false);
    await expect(store.verifyOtp(ALICE, "000002", 1_000_300)).resolves.toBe(false);
    await expect(store.verifyOtp(ALICE, "123456", 1_000_400)).resolves.toBe(false);
  });

  it("rejects expired OTP records and deletes them", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "123456", 1_000_000);
    await expect(store.verifyOtp(ALICE, "123456", 1_301_001)).resolves.toBe(false);
    await expect(store.verifyOtp(ALICE, "123456", 1_301_002)).resolves.toBe(false);
  });

  it("keeps public and admin OTP namespaces isolated and hashed in Redis keys", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "111111", 1_000_000);
    await store.saveOtp(ADMIN_ALICE, "222222", 1_000_000);

    await expect(store.verifyOtp(ALICE, "111111", 1_000_100)).resolves.toBe(true);
    await expect(store.verifyOtp(ADMIN_ALICE, "222222", 1_000_100)).resolves.toBe(true);

    const keys = redis.getAllKeysForTests();
    expect(keys).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("alice@stu.cu.edu.ng"),
      ]),
    );
  });

  it("stores the OTP hash rather than the plaintext OTP", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "123456", 1_000_000);

    const recordKey = (store as unknown as { getRecordKey(target: E164): string }).getRecordKey(ALICE);
    const record = redis.getHashForTests(recordKey);

    expect(record).toBeDefined();
    expect(record?.hash).toContain("$argon2");
    expect(record?.hash).not.toContain("123456");
  });

  it("fails closed when a verification lock already exists for the target", async () => {
    const redis = new FakeRedis();
    const store = makeStore(redis);

    await store.saveOtp(ALICE, "123456", 1_000_000);

    const lockKey = (store as unknown as { getVerifyLockKey(target: E164): string }).getVerifyLockKey(ALICE);
    await redis.set(lockKey, "busy", "PX", 5_000, "NX");

    await expect(store.verifyOtp(ALICE, "123456", 1_000_100)).resolves.toBe(false);
  });
});
