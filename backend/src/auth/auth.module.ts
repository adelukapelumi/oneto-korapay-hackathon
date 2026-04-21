import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpStoreService } from './otp-store.service';
import { JwtWrapperService } from './jwt.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    SmsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpStoreService, JwtWrapperService],
  exports: [AuthService, JwtWrapperService],
})
export class AuthModule {}
