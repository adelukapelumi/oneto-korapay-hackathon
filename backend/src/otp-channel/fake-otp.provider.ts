import { Injectable, Logger } from '@nestjs/common';
import { IOtpProvider } from './otp-provider.interface';

@Injectable()
export class FakeOtpProvider implements IOtpProvider {
  private readonly logger = new Logger(FakeOtpProvider.name);

  async sendOtp(target: string, code: string): Promise<void> {
    this.logger.log(`[FAKE OTP] to ${target}: ${code}`);
  }
}
