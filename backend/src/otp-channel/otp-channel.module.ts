import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeOtpProvider } from './fake-otp.provider';
import { ResendOtpProvider } from './resend-otp.provider';

@Module({
  providers: [
    {
      provide: 'OTP_PROVIDER',
      useFactory: (config: ConfigService) => {
        const env = config.get<string>('NODE_ENV');
        if (env === 'development' || env === 'test') {
          return new FakeOtpProvider();
        }
        return new ResendOtpProvider(config);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['OTP_PROVIDER'],
})
export class OtpChannelModule {}
