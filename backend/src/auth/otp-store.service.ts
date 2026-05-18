import { E164 } from "../common/phone";

export interface OtpStoreConfig {
  /** OTP validity in milliseconds. Default 5 minutes. */
  ttlMs: number;
  /** Maximum failed verification attempts before OTP is burned. */
  maxFailedAttempts: number;
  /** Rate limit window in milliseconds. Default 60 seconds. */
  rateLimitWindowMs: number;
  /** Max OTP requests per target per window. */
  maxRequestsPerWindow: number;
  /** Cleanup sweep interval in milliseconds. Default 60 seconds. */
  cleanupIntervalMs: number;
  /** Short lock TTL used to serialize Redis verification attempts. */
  verificationLockTtlMs: number;
}

export const DEFAULT_OTP_STORE_CONFIG: OtpStoreConfig = {
  ttlMs: 5 * 60 * 1000,
  maxFailedAttempts: 3,
  rateLimitWindowMs: 60 * 1000,
  maxRequestsPerWindow: 5,
  cleanupIntervalMs: 60 * 1000,
  verificationLockTtlMs: 5_000,
};

export class OtpRateLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("OTP request rate limit exceeded");
    this.name = "OtpRateLimitExceededError";
  }
}

/**
 * Abstraction for OTP persistence and per-target request throttling.
 *
 * Targets are still typed as E164 for compatibility with the current codebase,
 * even though email OTP now reuses this branded string type.
 */
export abstract class OtpStoreService {
  abstract checkAndRecordRequest(target: E164, nowMs?: number): void | Promise<void>;
  abstract saveOtp(target: E164, otp: string, nowMs?: number): Promise<void>;
  abstract verifyOtp(target: E164, otp: string, nowMs?: number): Promise<boolean>;
}

export const OTP_STORE = Symbol("OTP_STORE");
