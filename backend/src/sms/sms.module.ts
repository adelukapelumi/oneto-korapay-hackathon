import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeSmsProvider } from './fake-sms.provider';
import { TermiiSmsProvider } from './termii-sms.provider';

@Module({
  providers: [
    {
      provide: 'SMS_PROVIDER',
      useFactory: (config: ConfigService) => {
        // For pilot/development, default to fake provider.
        // If NODE_ENV is production and TERMII_API_KEY is set, we could use Termii.
        return new FakeSmsProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: ['SMS_PROVIDER'],
})
export class SmsModule {}
