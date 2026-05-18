import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import * as argon2 from "argon2";
import { E164 } from "../common/phone";
import {
  DEFAULT_OTP_STORE_CONFIG,
  OtpRateLimitExceededError,
  OtpStoreConfig,
  OtpStoreService,
} from "./otp-store.service";

interface OtpRecord {
  hash: string;
  expiresAt: number;
  failedAttempts: number;
}

interface RateLimitRecord {
  requestsInWindow: number[];
}

@Injectable()
export class InMemoryOtpStoreService
  extends OtpStoreService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly otps = new Map<string, OtpRecord>();
  private readonly rateLimits = new Map<string, RateLimitRecord>();
  private readonly config: OtpStoreConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(@Optional() config: Partial<OtpStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_OTP_STORE_CONFIG, ...config };
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => this.sweepExpired(),
      this.config.cleanupIntervalMs,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  sweepExpired(nowMs: number = Date.now()): { otpsRemoved: number; rateLimitsRemoved: number } {
    let otpsRemoved = 0;
    let rateLimitsRemoved = 0;

    for (const [key, record] of this.otps) {
      if (nowMs > record.expiresAt) {
        this.otps.delete(key);
        otpsRemoved++;
      }
    }

    const windowStart = nowMs - this.config.rateLimitWindowMs;
    for (const [key, record] of this.rateLimits) {
      const activeRequests = record.requestsInWindow.filter((ts) => ts > windowStart);
      if (activeRequests.length === 0) {
        this.rateLimits.delete(key);
        rateLimitsRemoved++;
      } else if (activeRequests.length !== record.requestsInWindow.length) {
        record.requestsInWindow = activeRequests;
      }
    }

    return { otpsRemoved, rateLimitsRemoved };
  }

  checkAndRecordRequest(target: E164, nowMs: number = Date.now()): void {
    const record = this.rateLimits.get(target) ?? { requestsInWindow: [] };
    const windowStart = nowMs - this.config.rateLimitWindowMs;

    record.requestsInWindow = record.requestsInWindow.filter((ts) => ts > windowStart);

    if (record.requestsInWindow.length >= this.config.maxRequestsPerWindow) {
      const oldest = record.requestsInWindow[0]!;
      const retryAfterMs = oldest + this.config.rateLimitWindowMs - nowMs;
      throw new OtpRateLimitExceededError(Math.max(retryAfterMs, 0));
    }

    record.requestsInWindow.push(nowMs);
    this.rateLimits.set(target, record);
  }

  async saveOtp(target: E164, otp: string, nowMs: number = Date.now()): Promise<void> {
    const hash = await argon2.hash(otp);
    this.otps.set(target, {
      hash,
      expiresAt: nowMs + this.config.ttlMs,
      failedAttempts: 0,
    });
  }

  async verifyOtp(target: E164, otp: string, nowMs: number = Date.now()): Promise<boolean> {
    const record = this.otps.get(target);
    if (!record) {
      return false;
    }

    if (nowMs > record.expiresAt) {
      this.otps.delete(target);
      return false;
    }

    const isValid = await argon2.verify(record.hash, otp);
    if (isValid) {
      this.otps.delete(target);
      return true;
    }

    record.failedAttempts += 1;
    if (record.failedAttempts >= this.config.maxFailedAttempts) {
      this.otps.delete(target);
    }

    return false;
  }

  _clearForTests(): void {
    this.otps.clear();
    this.rateLimits.clear();
  }

  _sizeForTests(): number {
    return this.otps.size;
  }

  _rateLimitsSizeForTests(): number {
    return this.rateLimits.size;
  }
}
