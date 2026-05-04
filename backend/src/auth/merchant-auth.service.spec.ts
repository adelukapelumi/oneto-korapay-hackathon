import { Test, TestingModule } from "@nestjs/testing";
import { MerchantAuthService, MerchantSignupData } from "./merchant-auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { OtpStoreService, OtpRateLimitExceededError } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";

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

      const stashed = (service as any).stash.get("test@example.com");
      expect(stashed).toBeDefined();
      expect(stashed.merchantData.phone).toBe("+2348012345678"); // Phone gets normalized
      expect(stashed.merchantData.businessName).toBe(dataWithPhone.businessName);
    });

    it("4. requestMerchantOtp: rate-limit exceeded -> ForbiddenException", async () => {
      otpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(60_000);
      });
      await expect(service.requestMerchantOtp("test@example.com", validMerchantData)).rejects.toThrow(ForbiddenException);
    });
  });

  describe("verifyMerchantOtp", () => {
    const email = "test@example.com";
    const code = "123456";

    beforeEach(() => {
      (service as any).stash.set(email, {
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
      (service as any).stash.delete(email); // Clear stash
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
      (service as any).stash.set("expired@example.com", {
        merchantData: validMerchantData,
        expiresAt: Date.now() - 1000, // Expired
      });
      (service as any).stash.set("valid@example.com", {
        merchantData: validMerchantData,
        expiresAt: Date.now() + 5000, // Valid
      });

      service.sweepExpired();

      expect((service as any).stash.has("expired@example.com")).toBe(false);
      expect((service as any).stash.has("valid@example.com")).toBe(true);
    });
  });
});
