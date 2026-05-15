import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import {
  RequestOtpSchema,
  VerifyOtpSchema,
  RequestAdminOtpSchema,
  VerifyAdminOtpSchema,
  RequestOtpDtoType,
  VerifyOtpDtoType,
  RequestAdminOtpDtoType,
  VerifyAdminOtpDtoType,
} from "./schemas";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * POST /auth/otp/request
   *
   * Rate limiting and validation happen inside AuthService.requestOtp,
   * keyed by the normalized email address after zod parsing.
   */
  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(RequestOtpSchema))
  async requestOtp(@Body() body: RequestOtpDtoType) {
    await this.authService.requestOtp(body.email);
    return { success: true, message: "OTP sent if the email address is valid" };
  }

  /**
   * POST /auth/otp/verify
   *
   * Brute-force protection lives inside OtpStoreService, which burns the
   * OTP after 3 failed attempts.
   */
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(VerifyOtpSchema))
  async verifyOtp(@Body() body: VerifyOtpDtoType) {
    const result = await this.authService.verifyOtp(body.email, body.code);
    return { success: true, accessToken: result.accessToken };
  }

  /**
   * POST /auth/admin/otp/request
   *
   * Dedicated admin login OTP request. Always returns { ok: true } to avoid
   * account enumeration. OTP is only sent for existing ACTIVE ADMIN users.
   */
  @Post("admin/otp/request")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(RequestAdminOtpSchema))
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async requestAdminOtp(@Body() body: RequestAdminOtpDtoType) {
    await this.authService.requestAdminOtp(body.email);
    return { ok: true };
  }

  /**
   * POST /auth/admin/otp/verify
   *
   * Dedicated admin OTP verification. Fails with generic auth error for
   * unknown/non-admin/inactive users and invalid OTP attempts.
   */
  @Post("admin/otp/verify")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(VerifyAdminOtpSchema))
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  async verifyAdminOtp(@Body() body: VerifyAdminOtpDtoType) {
    const result = await this.authService.verifyAdminOtp(body.email, body.code);
    return { success: true, accessToken: result.accessToken };
  }
}
