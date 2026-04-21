import { Injectable } from '@nestjs/common';
import { ISmsProvider } from './sms-provider.interface';

@Injectable()
export class TermiiSmsProvider implements ISmsProvider {
  async sendSms(phone: string, message: string): Promise<void> {
    // TODO: Implement actual Termii API call
    throw new Error('Termii API not implemented yet');
  }
}
