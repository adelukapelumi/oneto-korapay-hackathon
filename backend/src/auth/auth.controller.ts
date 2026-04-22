import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import {
  RequestOtpSchema,
  VerifyOtpSchema,
  RequestOtpDtoType,
  VerifyOtpDtoType,
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
}