import {
  Get,
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
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
import {
  ADMIN_SESSION_COOKIE_NAME,
  buildAdminSessionClearCookieOptions,
  buildAdminSessionCookieOptions,
} from "./admin-session.constants";
import { AdminCookieSessionGuard } from "./admin-cookie-session.guard";
import { JwtAuthGuard, type AuthenticatedRequest } from "./jwt-auth.guard";
import { RolesGuard } from "./role.guard";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) { }

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
  async verifyAdminOtp(
    @Body() body: VerifyAdminOtpDtoType,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.verifyAdminOtp(body.email, body.code);
    const nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";
    response.cookie(
      ADMIN_SESSION_COOKIE_NAME,
      result.accessToken,
      buildAdminSessionCookieOptions(nodeEnv),
    );

    return { success: true };
  }

  @Post("admin/logout")
  @HttpCode(HttpStatus.OK)
  async adminLogout(@Res({ passthrough: true }) response: Response) {
    const nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";
    response.clearCookie(
      ADMIN_SESSION_COOKIE_NAME,
      buildAdminSessionClearCookieOptions(nodeEnv),
    );
    return { success: true };
  }

  @Get("admin/session")
  @UseGuards(JwtAuthGuard, RolesGuard(["ADMIN"]), AdminCookieSessionGuard)
  async getAdminSession(@Req() req: AuthenticatedRequest) {
    return {
      authenticated: true,
      admin: {
        id: req.user?.sub,
        email: req.user?.email,
        role: req.user?.role,
      },
    };
  }
}
