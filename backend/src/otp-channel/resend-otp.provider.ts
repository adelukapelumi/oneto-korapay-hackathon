import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { IOtpProvider } from './otp-provider.interface';

@Injectable()
export class ResendOtpProvider implements IOtpProvider {
  private readonly logger = new Logger(ResendOtpProvider.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required in production');
    }

    this.fromAddress =
      this.config.get<string>('RESEND_FROM_ADDRESS') ?? 'oneto <noreply@oneto.ng>';

    this.resend = new Resend(apiKey);
  }

  async sendOtp(target: string, code: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: target,
      subject: 'Your oneto code',
      text: `Your oneto code is ${code}.\nThis code is valid for 5 minutes. If you did not request it, ignore this email.`,
    });

    if (error) {
      this.logger.error(`Failed to send OTP email to ${target}: ${error.message}`);
      throw new Error(`Failed to send OTP email: ${error.message}`);
    }
  }
}
