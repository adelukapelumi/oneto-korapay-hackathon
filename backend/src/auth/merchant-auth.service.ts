import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException, Inject } from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { OtpStoreService, OtpRateLimitExceededError } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { E164, normalizePhone, InvalidPhoneError } from "../common/phone";
import { normalizeEmail, InvalidEmailError } from "../common/email";

export interface MerchantSignupData {
  businessName: string;
  businessAddress?: string;
  phone?: string;
  cashoutBankName: string;
  cashoutBankCode: string;
  cashoutAccountNumber: string;
  cashoutAccountName: string;
}

interface StashedData {
  merchantData: MerchantSignupData;
  expiresAt: number;
}

@Injectable()
export class MerchantAuthService {
  private readonly stash = new Map<string, StashedData>();
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpStore: OtpStoreService,
    private readonly jwtService: JwtWrapperService,
    @Inject("OTP_PROVIDER") private readonly otpProvider: IOtpProvider,
  ) {
    // Basic periodic cleanup of expired stash entries
    setInterval(() => this.sweepExpired(), 60 * 1000).unref();
  }

  async requestMerchantOtp(rawEmail: string, merchantData: MerchantSignupData): Promise<void> {
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        throw new BadRequestException("Invalid email address");
      }
      throw err;
    }

    // Normalize phone if provided, using libphonenumber-js via our canonical helper.
    // Validates as a real Nigerian mobile (rejects landlines, garbage input, etc.).
    let phoneToStash: string | undefined = merchantData.phone;
    if (phoneToStash !== undefined && phoneToStash !== "") {
      try {
        phoneToStash = normalizePhone(phoneToStash);
      } catch (err) {
        if (err instanceof InvalidPhoneError) {
          throw new BadRequestException("invalid_phone");
        }
        throw err;
      }
    } else {
      phoneToStash = undefined;
    }

    try {
      this.otpStore.checkAndRecordRequest(email as unknown as E164);
    } catch (err) {
      if (err instanceof OtpRateLimitExceededError) {
        throw new ForbiddenException("Too many OTP requests. Please wait a moment.");
      }
      throw err;
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    await this.otpStore.saveOtp(email as unknown as E164, otp);
    await this.otpProvider.sendOtp(email, otp);

    // Stash the merchant data keyed by normalized email
    this.stash.set(email, {
      merchantData: { ...merchantData, phone: phoneToStash },
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async verifyMerchantOtp(rawEmail: string, code: string): Promise<{ accessToken: string }> {
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        throw new BadRequestException("Invalid email address");
      }
      throw err;
    }

    const isValid = await this.otpStore.verifyOtp(email as unknown as E164, code);
    if (!isValid) {
      throw new UnauthorizedException("Invalid or expired code");
    }

    const stashed = this.stash.get(email);
    if (!stashed || stashed.expiresAt < Date.now()) {
      if (stashed) this.stash.delete(email);
      throw new BadRequestException("no_pending_merchant_signup");
    }

    const { merchantData } = stashed;

    // We must execute user upsert and profile creation in a transaction
    // Also we need to check if user exists and has a different role
    const { accessToken } = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser && existingUser.role === "STUDENT") {
        throw new BadRequestException("email_already_registered_as_student");
      }

      const user = await tx.user.upsert({
        where: { email },
        update: {
          phone: merchantData.phone || existingUser?.phone,
        },
        create: {
          email,
          phone: merchantData.phone,
          role: "MERCHANT",
          status: "PENDING_VERIFICATION",
        },
      });

      if (user.status === "FROZEN") {
        throw new ForbiddenException("Account is frozen");
      }
      if (user.status === "FLAGGED") {
        throw new ForbiddenException("Account requires review");
      }

      await tx.merchantProfile.upsert({
        where: { userId: user.id },
        update: {
          businessName: merchantData.businessName,
          businessAddress: merchantData.businessAddress,
          cashoutBankName: merchantData.cashoutBankName,
          cashoutBankCode: merchantData.cashoutBankCode,
          cashoutAccountNumber: merchantData.cashoutAccountNumber,
          cashoutAccountName: merchantData.cashoutAccountName,
        },
        create: {
          userId: user.id,
          businessName: merchantData.businessName,
          businessAddress: merchantData.businessAddress,
          cashoutBankName: merchantData.cashoutBankName,
          cashoutBankCode: merchantData.cashoutBankCode,
          cashoutAccountNumber: merchantData.cashoutAccountNumber,
          cashoutAccountName: merchantData.cashoutAccountName,
        },
      });

      const token = this.jwtService.generateToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        pubKeyRegistered: user.publicKey !== null,
      });

      return { accessToken: token };
    });

    this.stash.delete(email);

    return { accessToken };
  }

  sweepExpired() {
    const now = Date.now();
    for (const [email, data] of this.stash.entries()) {
      if (data.expiresAt < now) {
        this.stash.delete(email);
      }
    }
  }
}
