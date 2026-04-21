import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

interface OtpRecord {
  hash: string;
  expiresAt: number;
  failedAttempts: number;
}

@Injectable()
export class OtpStoreService {
  private store = new Map<string, OtpRecord>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  async saveOtp(phone: string, otp: string): Promise<void> {
    const hash = await argon2.hash(otp);
    this.store.set(phone, {
      hash,
      expiresAt: Date.now() + this.TTL_MS,
      failedAttempts: 0,
    });
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const record = this.store.get(phone);
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      this.store.delete(phone);
      return false;
    }

    const isValid = await argon2.verify(record.hash, otp);
    if (isValid) {
      this.store.delete(phone); // Burn after reading
      return true;
    }

    record.failedAttempts += 1;
    if (record.failedAttempts >= 3) {
      this.store.delete(phone); // Burn after max attempts
    }
    return false;
  }
}
