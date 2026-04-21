import { Controller, Post, Body, HttpCode, HttpStatus, UsePipes, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpSchema, VerifyOtpSchema, RequestOtpDtoType, VerifyOtpDtoType } from './schemas';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { PhoneThrottlerGuard } from './phone-throttler.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PhoneThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @UsePipes(new ZodValidationPipe(RequestOtpSchema))
  async requestOtp(@Body() body: RequestOtpDtoType) {
    await this.authService.requestOtp(body.phone);
    return { success: true, message: 'OTP sent successfully' };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PhoneThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @UsePipes(new ZodValidationPipe(VerifyOtpSchema))
  async verifyOtp(@Body() body: VerifyOtpDtoType) {
    const result = await this.authService.verifyOtp(body.phone, body.code);
    return { success: true, accessToken: result.accessToken };
  }
}
