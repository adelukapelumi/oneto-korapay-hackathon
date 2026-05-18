import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import * as crypto from "crypto";
import type Redis from "ioredis";
import { E164 } from "../common/phone";
import { REDIS_CLIENT } from "../redis/redis.tokens";
import {
  DEFAULT_OTP_STORE_CONFIG,
  OtpRateLimitExceededError,
  OtpStoreConfig,
  OtpStoreService,
} from "./otp-store.service";

const OTP_RECORD_PREFIX = "otp:record";
const OTP_RATE_LIMIT_PREFIX = "otp:rate";
const OTP_VERIFY_LOCK_PREFIX = "otp:verify-lock";

const CHECK_AND_RECORD_REQUEST_SCRIPT = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local requestMember = ARGV[4]
local windowStart = nowMs - windowMs

redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

local requestCount = redis.call("ZCARD", key)
if requestCount >= maxRequests then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  if oldest[2] == nil then
    return {0, windowMs}
  end

  local retryAfterMs = (tonumber(oldest[2]) + windowMs) - nowMs
  if retryAfterMs < 0 then
    retryAfterMs = 0
  end

  return {0, retryAfterMs}
end

redis.call("ZADD", key, nowMs, requestMember)
redis.call("PEXPIRE", key, windowMs)

return {1, 0}
`;

const FINALIZE_VERIFY_SCRIPT = `
local recordKey = KEYS[1]
local expectedHash = ARGV[1]
local isValid = ARGV[2]
local maxFailedAttempts = tonumber(ARGV[3])

local currentHash = redis.call("HGET", recordKey, "hash")
if not currentHash then
  return {0, 0}
end

if currentHash ~= expectedHash then
  return {-2, 0}
end

if isValid == "1" then
  redis.call("DEL", recordKey)
  return {1, 0}
end

local failedAttempts = redis.call("HINCRBY", recordKey, "failedAttempts", 1)
if failedAttempts >= maxFailedAttempts then
  redis.call("DEL", recordKey)
  return {-1, failedAttempts}
end

return {2, failedAttempts}
`;

const RELEASE_LOCK_SCRIPT = `
local lockKey = KEYS[1]
local expectedToken = ARGV[1]

if redis.call("GET", lockKey) == expectedToken then
  return redis.call("DEL", lockKey)
end

return 0
`;

type ScriptTupleResult = [number, number];

@Injectable()
export class RedisOtpStoreService extends OtpStoreService {
  private readonly config: OtpStoreConfig = DEFAULT_OTP_STORE_CONFIG;
  private readonly secret: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis | null,
  ) {
    super();
    this.secret = this.configService.get<string>("JWT_SECRET") ?? "";
  }

  async checkAndRecordRequest(target: E164, nowMs: number = Date.now()): Promise<void> {
    const redis = this.getRedisClient();
    const result = await redis.eval(
      CHECK_AND_RECORD_REQUEST_SCRIPT,
      1,
      this.getRateLimitKey(target),
      nowMs,
      this.config.rateLimitWindowMs,
      this.config.maxRequestsPerWindow,
      `${nowMs}:${crypto.randomUUID()}`,
    );

    const [allowedFlag, retryAfterMs] = this.parseScriptTupleResult(result);
    if (allowedFlag !== 1) {
      throw new OtpRateLimitExceededError(retryAfterMs);
    }
  }

  async saveOtp(target: E164, otp: string, nowMs: number = Date.now()): Promise<void> {
    const redis = this.getRedisClient();
    const recordKey = this.getRecordKey(target);
    const hash = await argon2.hash(otp);
    const expiresAt = nowMs + this.config.ttlMs;

    // The hash and its metadata are written together so a restart never loses
    // the failed-attempt counter or expiry state for the active OTP.
    await redis.hset(
      recordKey,
      "hash",
      hash,
      "expiresAt",
      String(expiresAt),
      "failedAttempts",
      "0",
    );
    await redis.pexpire(recordKey, this.config.ttlMs);
  }

  async verifyOtp(target: E164, otp: string, nowMs: number = Date.now()): Promise<boolean> {
    const redis = this.getRedisClient();
    const recordKey = this.getRecordKey(target);
    const lockKey = this.getVerifyLockKey(target);
    const lockToken = crypto.randomUUID();

    // The short-lived lock serializes verification for one target so two
    // parallel correct OTP submissions cannot both consume the same record.
    const lockResult = await redis.set(
      lockKey,
      lockToken,
      "PX",
      this.config.verificationLockTtlMs,
      "NX",
    );
    if (lockResult === null) {
      return false;
    }

    try {
      const record = await redis.hgetall(recordKey);
      if (Object.keys(record).length === 0) {
        return false;
      }

      const expiresAt = Number(record.expiresAt);
      if (!Number.isFinite(expiresAt) || nowMs > expiresAt) {
        await redis.del(recordKey);
        return false;
      }

      const hash = record.hash;
      if (typeof hash !== "string" || hash.length === 0) {
        return false;
      }

      const isValid = await argon2.verify(hash, otp);
      const result = await redis.eval(
        FINALIZE_VERIFY_SCRIPT,
        1,
        recordKey,
        hash,
        isValid ? "1" : "0",
        this.config.maxFailedAttempts,
      );

      const [statusCode] = this.parseScriptTupleResult(result);
      return statusCode === 1;
    } finally {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken);
    }
  }

  private getRedisClient(): Redis {
    if (this.redisClient === null) {
      throw new Error("Redis OTP store is enabled without an initialized Redis client");
    }

    return this.redisClient;
  }

  private getRecordKey(target: E164): string {
    return `${OTP_RECORD_PREFIX}:${this.hashTarget(target)}`;
  }

  private getRateLimitKey(target: E164): string {
    return `${OTP_RATE_LIMIT_PREFIX}:${this.hashTarget(target)}`;
  }

  private getVerifyLockKey(target: E164): string {
    return `${OTP_VERIFY_LOCK_PREFIX}:${this.hashTarget(target)}`;
  }

  private hashTarget(target: E164): string {
    // Raw emails must never appear in Redis keys. The HMAC keeps the key
    // deterministic for lookup while hiding the original target value.
    return crypto
      .createHmac("sha256", this.secret)
      .update(target)
      .digest("hex");
  }

  private parseScriptTupleResult(result: unknown): ScriptTupleResult {
    if (
      !Array.isArray(result) ||
      result.length < 2 ||
      typeof result[0] !== "number" ||
      typeof result[1] !== "number"
    ) {
      throw new Error("Redis OTP script returned an unexpected result");
    }

    return [result[0], result[1]];
  }
}
