import { Controller, Post, Body, HttpCode, HttpStatus, UsePipes } from "@nestjs/common";
import { MerchantAuthService } from "./merchant-auth.service";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  RequestMerchantOtpSchema,
  RequestMerchantOtpDtoType,
  VerifyMerchantOtpSchema,
  VerifyOtpDtoType
} from "./schemas";

@Controller("auth/merchant")
export class MerchantAuthController {
  constructor(private readonly merchantAuthService: MerchantAuthService) { }

  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(RequestMerchantOtpSchema))
  async requestMerchantOtp(@Body() body: RequestMerchantOtpDtoType) {
    const { email, ...merchantData } = body;
    await this.merchantAuthService.requestMerchantOtp(email, merchantData);
    // Always return success to prevent email enumeration
    return { success: true, message: "OTP sent if the email is valid" };
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(VerifyMerchantOtpSchema))
  async verifyMerchantOtp(@Body() body: VerifyOtpDtoType) {
    const { accessToken } = await this.merchantAuthService.verifyMerchantOtp(body.email, body.code);
    return { success: true, accessToken };
  }
}
