import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class PhoneThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    const phone = req.body?.phone;
    
    if (phone) {
      return phone; // Key exclusively by phone to prevent IP rotation bypass
    }
    return ip;
  }
}
