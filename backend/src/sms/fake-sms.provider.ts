import { Injectable, Logger } from '@nestjs/common';
import { ISmsProvider } from './sms-provider.interface';

@Injectable()
export class FakeSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(FakeSmsProvider.name);

  async sendSms(phone: string, message: string): Promise<void> {
    this.logger.log(`[FAKE SMS] To: ${phone} | Message: ${message}`);
  }
}
