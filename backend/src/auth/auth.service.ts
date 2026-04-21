import { Injectable, UnauthorizedException, BadRequestException, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpStoreService } from './otp-store.service';
import { JwtWrapperService } from './jwt.service';
import { ISmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpStore: OtpStoreService,
    private readonly jwtService: JwtWrapperService,
    @Inject('SMS_PROVIDER') private readonly smsProvider: ISmsProvider,
  ) {}

  async requestOtp(phone: string): Promise<void> {
    // Generate 6 digit OTP using a CSPRNG
    const otp = crypto.randomInt(100000, 1000000).toString();
    
    await this.otpStore.saveOtp(phone, otp);
    
    // In production, send via SMS provider. For pilot/dev, fake provider logs it.
    await this.smsProvider.sendSms(phone, `Your oneto OTP is ${otp}. Valid for 5 minutes.`);
  }

  async verifyOtp(phone: string, code: string): Promise<{ accessToken: string }> {
    const isValid = await this.otpStore.verifyOtp(phone, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
        },
      });
    }

    if (user.status === 'FROZEN') {
      throw new BadRequestException('Account is frozen');
    }

    const accessToken = this.jwtService.generateToken({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    return { accessToken };
  }
}
