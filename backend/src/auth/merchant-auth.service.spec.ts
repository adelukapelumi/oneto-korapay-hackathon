import { Test, TestingModule } from "@nestjs/testing";
import { MerchantAuthService, MerchantSignupData } from "./merchant-auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { OtpStoreService, OtpRateLimitExceededError } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

describe("MerchantAuthService", () => {
  let service: MerchantAuthService;
  let prisma: any;
  let otpStore: any;
  let jwtService: any;
  let otpProvider: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      merchantProfile: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    otpStore = {
      checkAndRecordRequest: jest.fn(),
      saveOtp: jest.fn(),
      verifyOtp: jest.fn(),
    };

    jwtService = {
      generateToken: jest.fn(),
    };

    otpProvider = {
      sendOtp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpStoreService, useValue: otpStore },
        { provide: JwtWrapperService, useValue: jwtService },
        { provide: "OTP_PROVIDER", useValue: otpProvider },
      ],
    }).compile();

    service = module.get<MerchantAuthService>(MerchantAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const validMerchantData: MerchantSignupData = {
    businessName: "Test Business",
    cashoutBankName: "Wema Bank",
    cashoutBankCode: "035",
    cashoutAccountNumber: "1234567890",
    cashoutAccountName: "Test Account Name",
  };

  const getStash = (): Map<string, { merchantData: MerchantSignupData; expiresAt: number }> => {
    return (service as unknown as { stash: Map<string, { merchantData: MerchantSignupData; expiresAt: number }> }).stash;
  };

  describe("requestMerchantOtp", () => {
    it("1. requestMerchantOtp: rejects invalid email format", async () => {
      await expect(service.requestMerchantOtp("invalid-email", validMerchantData)).rejects.toThrow(BadRequestException);
      expect(otpStore.checkAndRecordRequest).not.toHaveBeenCalled();
    });

    it("2. requestMerchantOtp: normalizes email before rate-limit check and OTP save", async () => {
      await service.requestMerchantOtp(" Test@Example.com ", validMerchantData);
      expect(otpStore.checkAndRecordRequest).toHaveBeenCalledWith("test@example.com");
      expect(otpStore.saveOtp).toHaveBeenCalledWith("test@example.com", expect.any(String));
      expect(otpProvider.sendOtp).toHaveBeenCalledWith("test@example.com", expect.any(String));
    });

    it("3. requestMerchantOtp: stashes merchantData keyed by normalized email", async () => {
      const dataWithPhone = { ...validMerchantData, phone: "08012345678" };
      await service.requestMerchantOtp("test@example.com", dataWithPhone);

      const stashed = getStash().get("test@example.com");
      expect(stashed).toBeDefined();
      expect(stashed?.merchantData.phone).toBe("+2348012345678"); // Phone gets normalized
      expect(stashed?.merchantData.businessName).toBe(dataWithPhone.businessName);
    });

    it("4. requestMerchantOtp: rate-limit exceeded -> ForbiddenException", async () => {
      otpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(60_000);
      });
      await expect(service.requestMerchantOtp("test@example.com", validMerchantData)).rejects.toThrow(ForbiddenException);
    });

    it("5. requestMerchantOtp: throws ServiceUnavailableException when stash cap is reached for a new email", async () => {
      const stash = getStash();
      const futureExpiry = Date.now() + 60_000;

      for (let i = 0; i < 1_000; i += 1) {
        stash.set(`existing-${i}@example.com`, {
          merchantData: validMerchantData,
          expiresAt: futureExpiry,
        });
      }

      await expect(service.requestMerchantOtp("new@example.com", validMerchantData)).rejects.toThrow(ServiceUnavailableException);

      await service.requestMerchantOtp("new@example.com", validMerchantData).catch((error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) {
          throw error;
        }

        expect(error.getResponse()).toMatchObject({
          code: "merchant_signup_queue_full",
          message: "Merchant signup is temporarily busy. Please try again shortly.",
        });
      });
    });

    it("6. requestMerchantOtp: allows overwriting an existing email even when stash cap is reached", async () => {
      const stash = getStash();
      const futureExpiry = Date.now() + 60_000;

      for (let i = 0; i < 999; i += 1) {
        stash.set(`existing-${i}@example.com`, {
          merchantData: validMerchantData,
          expiresAt: futureExpiry,
        });
      }

      stash.set("test@example.com", {
        merchantData: validMerchantData,
        expiresAt: futureExpiry,
      });

      await expect(service.requestMerchantOtp("test@example.com", {
        ...validMerchantData,
        businessName: "Updated Biz Name",
      })).resolves.toBeUndefined();

      expect(getStash().get("test@example.com")?.merchantData.businessName).toBe("Updated Biz Name");
      expect(getStash().size).toBe(1_000);
    });

    it("7. requestMerchantOtp: cleans expired stash entries before enforcing cap", async () => {
      const stash = getStash();
      const now = Date.now();

      for (let i = 0; i < 999; i += 1) {
        stash.set(`valid-${i}@example.com`, {
          merchantData: validMerchantData,
          expiresAt: now + 60_000,
        });
      }

      stash.set("expired@example.com", {
        merchantData: validMerchantData,
        expiresAt: now - 1_000,
      });

      await expect(service.requestMerchantOtp("fresh@example.com", validMerchantData)).resolves.toBeUndefined();
      expect(getStash().has("expired@example.com")).toBe(false);
      expect(getStash().has("fresh@example.com")).toBe(true);
    });

    it("8. requestMerchantOtp: silently ignores ADMIN emails to prevent enumeration", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "u_1", email: "admin@example.com", role: "ADMIN" });
      await expect(service.requestMerchantOtp("admin@example.com", validMerchantData)).resolves.toBeUndefined();
      expect(otpStore.checkAndRecordRequest).not.toHaveBeenCalled();
    });
  });

  describe("verifyMerchantOtp", () => {
    const email = "test@example.com";
    const code = "123456";

    beforeEach(() => {
      getStash().set(email, {
        merchantData: validMerchantData,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    });

    it("5. verifyMerchantOtp: rejects wrong code (OtpStore returns false)", async () => {
      otpStore.verifyOtp.mockResolvedValue(false);
      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow(UnauthorizedException);
    });

    it("6. verifyMerchantOtp: rejects if no pending merchantData for this email", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      getStash().delete(email); // Clear stash
      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow(BadRequestException);
      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow("no_pending_merchant_signup");
    });

    it("7. verifyMerchantOtp: creates User with role=MERCHANT and status=PENDING_VERIFICATION", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: "u_1", email, role: "MERCHANT", status: "PENDING_VERIFICATION" };
      prisma.user.upsert.mockResolvedValue(createdUser);
      jwtService.generateToken.mockReturnValue("token_123");

      await service.verifyMerchantOtp(email, code);

      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { email },
        update: { phone: undefined },
        create: {
          email,
          phone: undefined,
          role: "MERCHANT",
          status: "PENDING_VERIFICATION",
        },
      });
    });

    it("8. verifyMerchantOtp: creates MerchantProfile with all provided fields", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: "u_1", email, role: "MERCHANT", status: "PENDING_VERIFICATION" };
      prisma.user.upsert.mockResolvedValue(createdUser);
      jwtService.generateToken.mockReturnValue("token_123");

      await service.verifyMerchantOtp(email, code);

      expect(prisma.merchantProfile.upsert).toHaveBeenCalledWith({
        where: { userId: "u_1" },
        update: {
          businessName: validMerchantData.businessName,
          businessAddress: undefined,
          cashoutBankName: validMerchantData.cashoutBankName,
          cashoutBankCode: validMerchantData.cashoutBankCode,
          cashoutAccountNumber: validMerchantData.cashoutAccountNumber,
          cashoutAccountName: validMerchantData.cashoutAccountName,
        },
        create: {
          userId: "u_1",
          businessName: validMerchantData.businessName,
          businessAddress: undefined,
          cashoutBankName: validMerchantData.cashoutBankName,
          cashoutBankCode: validMerchantData.cashoutBankCode,
          cashoutAccountNumber: validMerchantData.cashoutAccountNumber,
          cashoutAccountName: validMerchantData.cashoutAccountName,
        },
      });
    });

    it("9. verifyMerchantOtp: if existing User with same email has role=STUDENT -> reject ('email_already_registered_as_student')", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue({ id: "u_1", email, role: "STUDENT" });

      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow(BadRequestException);
      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow("email_already_registered_as_student");
    });

    it("9b. verifyMerchantOtp: if existing User with same email has role=ADMIN -> reject ('admin_cannot_register_as_merchant')", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue({ id: "u_1", email, role: "ADMIN" });

      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow(ForbiddenException);
      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow("admin_cannot_register_as_merchant");
    });

    it("10. verifyMerchantOtp: returns JWT with correct claims {sub, email, role: MERCHANT}", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: "u_1", email, role: "MERCHANT", status: "PENDING_VERIFICATION" };
      prisma.user.upsert.mockResolvedValue(createdUser);
      jwtService.generateToken.mockReturnValue("token_123");

      const result = await service.verifyMerchantOtp(email, code);

      expect(result).toEqual({ accessToken: "token_123" });
      expect(jwtService.generateToken).toHaveBeenCalledWith({
        sub: "u_1",
        email,
        role: "MERCHANT",
        pubKeyRegistered: true,
      });
    });

    it("11. verifyMerchantOtp: FROZEN status -> ForbiddenException", async () => {
      otpStore.verifyOtp.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue({ id: "u_1", email, role: "MERCHANT" });
      const upsertedUser = { id: "u_1", email, role: "MERCHANT", status: "FROZEN" };
      prisma.user.upsert.mockResolvedValue(upsertedUser);

      await expect(service.verifyMerchantOtp(email, code)).rejects.toThrow(ForbiddenException);
    });
  });

  describe("stash cleanup", () => {
    it("12. stash cleanup: sweepExpired removes stashed data past TTL", () => {
      getStash().set("expired@example.com", {
        merchantData: validMerchantData,
        expiresAt: Date.now() - 1000, // Expired
      });
      getStash().set("valid@example.com", {
        merchantData: validMerchantData,
        expiresAt: Date.now() + 5000, // Valid
      });

      service.sweepExpired();

      expect(getStash().has("expired@example.com")).toBe(false);
      expect(getStash().has("valid@example.com")).toBe(true);
    });
  });
});
