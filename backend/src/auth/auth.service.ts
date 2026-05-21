import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  OTP_STORE,
  OtpStoreService,
  OtpRateLimitExceededError,
} from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { E164 } from "../common/phone";
import { normalizeEmail, InvalidEmailError } from "../common/email";
import { ADMIN_SESSION_MAX_AGE_SECONDS } from "./admin-session.constants";
import { generateOnetoUserId } from "../common/user-id";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_STORE) private readonly otpStore: OtpStoreService,
    private readonly jwtService: JwtWrapperService,
    @Inject("OTP_PROVIDER") private readonly otpProvider: IOtpProvider,
  ) { }

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
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        throw new BadRequestException("Invalid email address");
      }
      throw err;
    }

    // Defense in depth: Check if this email belongs to an ADMIN.
    // If so, pretend we succeeded (so attackers can't enumerate admin emails)
    // but do not actually send an OTP.
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });

    if (existingUser?.role === Role.ADMIN) {
      this.logger.warn("Auth: blocked OTP request for ADMIN role.");
      return;
    }

    try {
      // Intentional cast: OtpStoreService uses E164 branded type as its key,
      // but it is channel-agnostic. We pass the normalized email through the
      // same API. The branded type will be generalized in a future session.
      await this.otpStore.checkAndRecordRequest(email as unknown as E164);
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
   * Dedicated admin OTP request path.
   *
   * Security goals:
   * - Never create or mutate users.
   * - Prevent account enumeration by returning generic success for all inputs.
   * - Send OTP only to existing ACTIVE ADMIN users.
   */
  async requestAdminOtp(rawEmail: string): Promise<void> {
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        return;
      }
      throw err;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { role: true, status: true },
    });

    if (
      !existingUser ||
      existingUser.role !== Role.ADMIN ||
      existingUser.status !== "ACTIVE"
    ) {
      return;
    }

    const adminOtpKey = `admin:${email}` as unknown as E164;

    try {
      await this.otpStore.checkAndRecordRequest(adminOtpKey);
    } catch (err) {
      if (err instanceof OtpRateLimitExceededError) {
        // Keep response enumeration-safe by behaving like a no-op.
        return;
      }
      throw err;
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    await this.otpStore.saveOtp(adminOtpKey, otp);
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
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        throw new BadRequestException("Invalid email address");
      }
      throw err;
    }

    // Defense in depth: Even if an OTP was somehow issued, block verification for ADMIN.
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });

    if (existingUser?.role === Role.ADMIN) {
      this.logger.warn("Auth: blocked OTP request for ADMIN role.");
      // Throw the generic error to avoid leaking the admin status.
      throw new UnauthorizedException("Invalid or expired code");
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
      create: {
        id: generateOnetoUserId(),
        email,
      },
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
      pubKeyRegistered: user.publicKey !== null,
    });

    return { accessToken };
  }

  /**
   * Dedicated admin OTP verification path.
   *
   * Security goals:
   * - Only existing ACTIVE ADMIN users can authenticate.
   * - No user creation/upsert or role mutation.
   * - Generic auth failure for unknown/non-admin/inactive/invalid-OTP cases.
   */
  async verifyAdminOtp(rawEmail: string, code: string): Promise<{ accessToken: string }> {
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        throw new UnauthorizedException("Invalid or expired code");
      }
      throw err;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, status: true, publicKey: true },
    });

    if (
      !existingUser ||
      existingUser.role !== Role.ADMIN ||
      existingUser.status !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Invalid or expired code");
    }

    const adminOtpKey = `admin:${email}` as unknown as E164;
    const isValid = await this.otpStore.verifyOtp(adminOtpKey, code);
    if (!isValid) {
      throw new UnauthorizedException("Invalid or expired code");
    }

    const accessToken = this.jwtService.generateToken({
      sub: existingUser.id,
      email: existingUser.email,
      role: existingUser.role,
      pubKeyRegistered: existingUser.publicKey !== null,
    }, {
      expiresIn: ADMIN_SESSION_MAX_AGE_SECONDS,
    });

    return { accessToken };
  }
}
