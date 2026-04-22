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
import { ISmsProvider } from "../sms/sms-provider.interface";
import { InvalidPhoneError, normalizePhone } from "../common/phone";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpStore: OtpStoreService,
    private readonly jwtService: JwtWrapperService,
    @Inject("SMS_PROVIDER") private readonly smsProvider: ISmsProvider,
  ) { }

  /**
   * Request an OTP be sent to a phone number.
   *
   * Steps:
   *  1. Normalize the phone. Invalid format → 400.
   *  2. Check per-phone rate limit. Exceeded → 429.
   *  3. Generate a 6-digit CSPRNG OTP.
   *  4. Save OTP hash with TTL.
   *  5. Dispatch via SMS provider.
   *
   * Intentional: we do NOT create a User row here. Users are created on
   * successful OTP verification only. This prevents spam-filled user
   * tables from phone-number enumeration.
   */
  async requestOtp(rawPhone: string): Promise<void> {
    let phone;
    try {
      phone = normalizePhone(rawPhone);
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        throw new BadRequestException("Invalid phone number");
      }
      throw err;
    }

    try {
      this.otpStore.checkAndRecordRequest(phone);
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

    await this.otpStore.saveOtp(phone, otp);

    await this.smsProvider.sendSms(
      phone,
      `Your oneto code is ${otp}. Valid for 5 minutes.`,
    );
  }

  /**
   * Verify an OTP and issue an access token.
   *
   * Steps:
   *  1. Normalize the phone.
   *  2. Verify OTP against store (burns on success or 3rd failure).
   *  3. Upsert the User record (first successful login creates the account).
   *  4. Reject if account is frozen or flagged.
   *  5. Issue short-lived JWT.
   *
   * Note: Account creation on first successful verify means a brand-new
   * phone with a valid OTP will receive both an account AND a token.
   * This is deliberate — OTP verification IS the account creation for oneto.
   */
  async verifyOtp(rawPhone: string, code: string): Promise<{ accessToken: string }> {
    let phone;
    try {
      phone = normalizePhone(rawPhone);
    } catch (err) {
      if (err instanceof InvalidPhoneError) {
        throw new BadRequestException("Invalid phone number");
      }
      throw err;
    }

    const isValid = await this.otpStore.verifyOtp(phone, code);
    if (!isValid) {
      // Generic error — do not leak whether the phone has a pending OTP,
      // whether it was expired, or whether brute-force counter was hit.
      throw new UnauthorizedException("Invalid or expired code");
    }

    // Upsert user. First successful verification creates the account.
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
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
      phone: user.phone,
      role: user.role,
    });

    return { accessToken };
  }
}