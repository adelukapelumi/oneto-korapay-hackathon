import { Injectable } from "@nestjs/common";
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
}

const DEFAULT_CONFIG: OtpStoreConfig = {
  ttlMs: 5 * 60 * 1000,
  maxFailedAttempts: 3,
  rateLimitWindowMs: 60 * 1000,
  maxRequestsPerWindow: 5,
};

export class OtpRateLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("OTP request rate limit exceeded");
    this.name = "OtpRateLimitExceededError";
  }
}

@Injectable()
export class OtpStoreService {
  private readonly otps = new Map<string, OtpRecord>();
  private readonly rateLimits = new Map<string, RateLimitRecord>();
  private readonly config: OtpStoreConfig;

  constructor(config: Partial<OtpStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check whether a new OTP may be requested for this phone right now.
   * Throws OtpRateLimitExceededError if the caller is over the per-minute
   * limit. Otherwise records the request timestamp.
   *
   * Call this BEFORE generating an OTP, not after, so that the rate-limit
   * check is not dependent on the OTP actually being sent successfully.
   */
  checkAndRecordRequest(phone: E164, nowMs: number = Date.now()): void {
    const record = this.rateLimits.get(phone) ?? { requestsInWindow: [] };

    // Drop timestamps outside the window.
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

  /**
   * Save a new OTP for a phone. Replaces any existing OTP for that phone.
   *
   * The OTP is hashed with Argon2 before storage. The plaintext is never
   * retained — if we need to resend, we must generate a new one.
   */
  async saveOtp(phone: E164, otp: string, nowMs: number = Date.now()): Promise<void> {
    const hash = await argon2.hash(otp);
    this.otps.set(phone, {
      hash,
      expiresAt: nowMs + this.config.ttlMs,
      failedAttempts: 0,
    });
  }

  /**
   * Verify an OTP for a phone.
   *
   * Returns true on success AND burns the OTP record.
   * Returns false if: no record, expired, wrong code.
   * After maxFailedAttempts wrong guesses, the record is also burned.
   *
   * Timing: argon2.verify runs in constant time, so an attacker cannot
   * distinguish "wrong OTP" from "right OTP but expired" via timing.
   */
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

  /**
   * Test-only / admin-only: wipe all state.
   * Used in unit tests to isolate runs. Never call from production code.
   */
  _clearForTests(): void {
    this.otps.clear();
    this.rateLimits.clear();
  }

  /**
   * Test-only introspection: how many OTP records exist?
   * Used to verify burn behavior. Never call from production code.
   */
  _sizeForTests(): number {
    return this.otps.size;
  }
}