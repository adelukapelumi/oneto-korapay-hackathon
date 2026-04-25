import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from "@nestjs/common";
import * as argon2 from "argon2";
import { E164 } from "../common/phone";

/**
 * Per-phone record holding the active OTP and its metadata.
 * Stored in-memory for the pilot. Migrates to Redis post-pilot.
 */
interface OtpRecord {
  hash: string;
  expiresAt: number;
  failedAttempts: number;
}

/**
 * Per-phone record holding request timestamps for rate limiting.
 * Kept separate from OtpRecord because request-rate survives past OTP burn.
 */
interface RateLimitRecord {
  requestsInWindow: number[]; // timestamps of recent OTP requests
}

export interface OtpStoreConfig {
  /** OTP validity in milliseconds. Default 5 minutes. */
  ttlMs: number;
  /** Maximum failed verification attempts before OTP is burned. */
  maxFailedAttempts: number;
  /** Rate limit window in milliseconds. Default 60 seconds. */
  rateLimitWindowMs: number;
  /** Max OTP requests per phone per window. */
  maxRequestsPerWindow: number;
  /** Cleanup sweep interval in milliseconds. Default 60 seconds. */
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: OtpStoreConfig = {
  ttlMs: 5 * 60 * 1000,
  maxFailedAttempts: 3,
  rateLimitWindowMs: 60 * 1000,
  maxRequestsPerWindow: 5,
  cleanupIntervalMs: 60 * 1000,
};

export class OtpRateLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("OTP request rate limit exceeded");
    this.name = "OtpRateLimitExceededError";
  }
}

@Injectable()
export class OtpStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly otps = new Map<string, OtpRecord>();
  private readonly rateLimits = new Map<string, RateLimitRecord>();
  private readonly config: OtpStoreConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(@Optional() config: Partial<OtpStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onModuleInit(): void {
    // Start the periodic cleanup sweep. In tests this can be disabled by
    // instantiating OtpStoreService directly without calling onModuleInit.
    this.cleanupTimer = setInterval(
      () => this.sweepExpired(),
      this.config.cleanupIntervalMs,
    );
    // Prevents the interval from keeping the Node process alive (important
    // for graceful shutdown).
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Remove expired OTP records and stale rate-limit windows.
   *
   * Runs every cleanupIntervalMs via setInterval started in onModuleInit.
   * Can also be called manually in tests to verify cleanup behavior.
   */
  sweepExpired(nowMs: number = Date.now()): { otpsRemoved: number; rateLimitsRemoved: number } {
    let otpsRemoved = 0;
    let rateLimitsRemoved = 0;

    // Sweep OTPs whose TTL has passed.
    for (const [key, record] of this.otps) {
      if (nowMs > record.expiresAt) {
        this.otps.delete(key);
        otpsRemoved++;
      }
    }

    // Sweep rate-limit records whose window is fully in the past.
    const windowStart = nowMs - this.config.rateLimitWindowMs;
    for (const [key, record] of this.rateLimits) {
      const activeRequests = record.requestsInWindow.filter((ts) => ts > windowStart);
      if (activeRequests.length === 0) {
        this.rateLimits.delete(key);
        rateLimitsRemoved++;
      } else if (activeRequests.length !== record.requestsInWindow.length) {
        // Trim stale timestamps even if the record isn't fully empty.
        record.requestsInWindow = activeRequests;
      }
    }

    return { otpsRemoved, rateLimitsRemoved };
  }

  /**
   * Check whether a new OTP may be requested for this phone right now.
   * Throws OtpRateLimitExceededError if the caller is over the per-minute
   * limit. Otherwise records the request timestamp.
   */
  checkAndRecordRequest(phone: E164, nowMs: number = Date.now()): void {
    const record = this.rateLimits.get(phone) ?? { requestsInWindow: [] };

    const windowStart = nowMs - this.config.rateLimitWindowMs;
    record.requestsInWindow = record.requestsInWindow.filter((ts) => ts > windowStart);

    if (record.requestsInWindow.length >= this.config.maxRequestsPerWindow) {
      const oldest = record.requestsInWindow[0]!;
      const retryAfterMs = oldest + this.config.rateLimitWindowMs - nowMs;
      throw new OtpRateLimitExceededError(Math.max(retryAfterMs, 0));
    }

    record.requestsInWindow.push(nowMs);
    this.rateLimits.set(phone, record);
  }

  async saveOtp(phone: E164, otp: string, nowMs: number = Date.now()): Promise<void> {
    const hash = await argon2.hash(otp);
    this.otps.set(phone, {
      hash,
      expiresAt: nowMs + this.config.ttlMs,
      failedAttempts: 0,
    });
  }

  async verifyOtp(phone: E164, otp: string, nowMs: number = Date.now()): Promise<boolean> {
    const record = this.otps.get(phone);
    if (!record) return false;

    if (nowMs > record.expiresAt) {
      this.otps.delete(phone);
      return false;
    }

    const isValid = await argon2.verify(record.hash, otp);

    if (isValid) {
      this.otps.delete(phone);
      return true;
    }

    record.failedAttempts += 1;
    if (record.failedAttempts >= this.config.maxFailedAttempts) {
      this.otps.delete(phone);
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