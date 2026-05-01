import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * UserThrottlerGuard overrides the default IP-based tracker with a JWT sub-based tracker.
 * This ensures that rate limits are applied per-user rather than per-IP for sensitive routes.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  /**
   * Overrides getTracker to use req.user.sub (the JWT subject) if available.
   * If no user is present (e.g. before auth or if auth failed), it must NOT skip throttling;
   * instead, it falls back to req.ip to maintain the coarse safety net.
   */
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.sub || req.ip;
  }
}
