import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { OtpStoreService, OtpRateLimitExceededError } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { E164 } from "../common/phone";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpStore: OtpStoreService,
    private readonly jwtService: JwtWrapperService,
    @Inject("OTP_PROVIDER") private readonly otpProvider: IOtpProvider,
  ) { }

  /**
   * Normalize an email address: lowercase + trim.
   * This is the email equivalent of phone normalization.
   */
  private normalizeEmail(rawEmail: string): string {
    return rawEmail.toLowerCase().trim();
  }

  /**
   * Request an OTP be sent to an email address.
   *
   * Steps:
   *  1. Normalize the email (lowercase + trim).
   *  2. Check per-target rate limit. Exceeded → 429.
   *  3. Generate a 6-digit CSPRNG OTP.
   *  4. Save OTP hash with TTL.
   *  5. Dispatch via OTP provider (email in production, console in dev).
   *
   * Intentional: we do NOT create a User row here. Users are created on
   * successful OTP verification only. This prevents spam-filled user
   * tables from email enumeration.
   *
   * NOTE: OtpStoreService is typed with E164 (phone branded type) but is
   * channel-agnostic in practice — it just uses the branded string as a
   * map key. We pass emails through with an unknown-cast. The E164 type
   * will be renamed to a generic OTP target type in a future session.
   */
  async requestOtp(rawEmail: string): Promise<void> {
    const email = this.normalizeEmail(rawEmail);

    if (!email) {
      throw new BadRequestException("Invalid email address");
    }

    try {
      // Intentional cast: OtpStoreService uses E164 branded type as its key,
      // but it is channel-agnostic. We pass the normalized email through the
      // same API. The branded type will be generalized in a future session.
      this.otpStore.checkAndRecordRequest(email as unknown as E164);
    } catch (err) {
      if (err instanceof OtpRateLimitExceededError) {
        // 429 Too Many Requests
        throw new ForbiddenException("Too many OTP requests. Please wait a moment.");
      }
      throw err;
    }

    // 6-digit OTP via cryptographically-secure RNG.
    // randomInt's upper bound is exclusive, so this yields 100000..999999.
    const otp = crypto.randomInt(100000, 1000000).toString();

    await this.otpStore.saveOtp(email as unknown as E164, otp);

    await this.otpProvider.sendOtp(email, otp);
  }

  /**
   * Verify an OTP and issue an access token.
   *
   * Steps:
   *  1. Normalize the email.
   *  2. Verify OTP against store (burns on success or 3rd failure).
   *  3. Upsert the User record by email (first successful login creates the account).
   *  4. Reject if account is frozen or flagged.
   *  5. Issue short-lived JWT.
   *
   * Note: Account creation on first successful verify means a brand-new
   * email with a valid OTP will receive both an account AND a token.
   * This is deliberate — OTP verification IS the account creation for oneto.
   */
  async verifyOtp(rawEmail: string, code: string): Promise<{ accessToken: string }> {
    const email = this.normalizeEmail(rawEmail);

    if (!email) {
      throw new BadRequestException("Invalid email address");
    }

    const isValid = await this.otpStore.verifyOtp(email as unknown as E164, code);
    if (!isValid) {
      // Generic error — do not leak whether the email has a pending OTP,
      // whether it was expired, or whether brute-force counter was hit.
      throw new UnauthorizedException("Invalid or expired code");
    }

    // Upsert user by email. First successful verification creates the account.
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    // Account state checks — block login for admin-flagged accounts.
    if (user.status === "FROZEN") {
      throw new ForbiddenException("Account is frozen");
    }
    if (user.status === "FLAGGED") {
      throw new ForbiddenException("Account requires review");
    }

    // TODO: once the mobile app registers a device public key,
    // include a pubKeyRegistered flag in the token so the client
    // knows whether to trigger the key-registration flow after login.

    const accessToken = this.jwtService.generateToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken };
  }
}