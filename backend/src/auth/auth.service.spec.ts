import { AuthService } from "./auth.service";
import { OtpStoreService, OtpRateLimitExceededError } from "./otp-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtWrapperService } from "./jwt.service";
import { IOtpProvider } from "../otp-channel/otp-provider.interface";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { E164 } from "../common/phone";

// -- FIXTURES & HELPERS --

function makeUser(overrides: any = {}) {
  return {
    id: "u_test00000000001",
    email: "alice@stu.cu.edu.ng",
    phone: null,
    publicKey: null,
    sequenceNumber: 1,
    verifiedBalanceKobo: 0n,
    status: "ACTIVE",
    role: "STUDENT",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("AuthService", () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockOtpStore: any;
  let mockJwt: any;
  let mockOtpProvider: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    mockOtpStore = {
      checkAndRecordRequest: jest.fn(),
      saveOtp: jest.fn(),
      verifyOtp: jest.fn(),
    };

    mockJwt = {
      generateToken: jest.fn(),
    };

    mockOtpProvider = {
      sendOtp: jest.fn(),
    };

    authService = new AuthService(
      mockPrisma as unknown as PrismaService,
      mockOtpStore as unknown as OtpStoreService,
      mockJwt as unknown as JwtWrapperService,
      mockOtpProvider as IOtpProvider
    );
  });

  const resetMocks = () => {
    jest.clearAllMocks();
  };

  // ------- Group 1: email normalization and validation -------

  describe("email normalization and validation", () => {
    beforeEach(() => resetMocks());

    it("rejects empty string with BadRequestException", async () => {
      await expect(authService.requestOtp("")).rejects.toThrow(BadRequestException);
    });

    it("rejects whitespace-only string with BadRequestException", async () => {
      await expect(authService.requestOtp("   ")).rejects.toThrow(BadRequestException);
    });

    it("rejects malformed string (no @) with BadRequestException", async () => {
      await expect(authService.requestOtp("notanemail")).rejects.toThrow(BadRequestException);
    });

    it("rejects invalid domain format with BadRequestException", async () => {
      await expect(authService.requestOtp("alice@domain")).rejects.toThrow(BadRequestException);
    });
  });

  // ------- Group 2: requestOtp happy path -------

  describe("requestOtp happy path", () => {
    beforeEach(() => resetMocks());

    it("calls otpStore.checkAndRecordRequest before generating OTP", async () => {
      await authService.requestOtp("ALICE@stu.cu.edu.ng");
      expect(mockOtpStore.checkAndRecordRequest).toHaveBeenCalledWith("alice@stu.cu.edu.ng" as unknown as E164);
    });

    it("generates a 6-digit OTP in range 100000-999999 inclusive", async () => {
      await authService.requestOtp("alice@stu.cu.edu.ng");
      expect(mockOtpStore.saveOtp).toHaveBeenCalledTimes(1);

      const savedOtp = mockOtpStore.saveOtp.mock.calls[0][1];
      expect(typeof savedOtp).toBe("string");
      expect(savedOtp.length).toBe(6);

      const numericOtp = parseInt(savedOtp, 10);
      expect(numericOtp).toBeGreaterThanOrEqual(100000);
      expect(numericOtp).toBeLessThanOrEqual(999999);
    });

    it("calls otpStore.saveOtp with the normalized email", async () => {
      await authService.requestOtp("  BOB@stu.cu.edu.ng  ");
      expect(mockOtpStore.saveOtp).toHaveBeenCalledWith("bob@stu.cu.edu.ng" as unknown as E164, expect.any(String));
    });

    it("calls otpProvider.sendOtp with the same email and the generated OTP", async () => {
      await authService.requestOtp("charlie@stu.cu.edu.ng");
      const savedOtp = mockOtpStore.saveOtp.mock.calls[0][1];

      expect(mockOtpProvider.sendOtp).toHaveBeenCalledTimes(1);
      expect(mockOtpProvider.sendOtp).toHaveBeenCalledWith("charlie@stu.cu.edu.ng", savedOtp);
    });

    it("does NOT create a user row in Prisma", async () => {
      await authService.requestOtp("diana@stu.cu.edu.ng");
      expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    });
  });

  // ------- Group 3: requestOtp rate limiting -------

  describe("requestOtp rate limiting", () => {
    beforeEach(() => resetMocks());

    it("throws ForbiddenException when checkAndRecordRequest throws OtpRateLimitExceededError", async () => {
      mockOtpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(30000);
      });

      await expect(authService.requestOtp("eve@stu.cu.edu.ng")).rejects.toThrow(ForbiddenException);
    });

    it("maps the error to a generic user-facing message without leaking retryAfter", async () => {
      mockOtpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(45000);
      });

      await expect(authService.requestOtp("eve@stu.cu.edu.ng")).rejects.toThrow("Too many OTP requests. Please wait a moment.");

      try {
        await authService.requestOtp("eve@stu.cu.edu.ng");
      } catch (err: any) {
        expect(err.message).not.toContain("45000");
      }
    });

    it("does NOT call saveOtp when rate limit throws", async () => {
      mockOtpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(10000);
      });

      try {
        await authService.requestOtp("eve@stu.cu.edu.ng");
      } catch { }

      expect(mockOtpStore.saveOtp).not.toHaveBeenCalled();
    });

    it("does NOT call sendOtp when rate limit throws", async () => {
      mockOtpStore.checkAndRecordRequest.mockImplementation(() => {
        throw new OtpRateLimitExceededError(10000);
      });

      try {
        await authService.requestOtp("eve@stu.cu.edu.ng");
      } catch { }

      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });
  });

  // ------- Group 4: verifyOtp rejection paths -------

  describe("verifyOtp rejection paths", () => {
    beforeEach(() => resetMocks());

    it("throws UnauthorizedException when verifyOtp returns false", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(false);
      await expect(authService.verifyOtp("alice@stu.cu.edu.ng", "123456")).rejects.toThrow(UnauthorizedException);
    });

    it("uses a generic error message", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(false);
      await expect(authService.verifyOtp("alice@stu.cu.edu.ng", "123456")).rejects.toThrow("Invalid or expired code");
    });

    it("does NOT call Prisma.user.upsert when verification fails", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(false);
      try {
        await authService.verifyOtp("alice@stu.cu.edu.ng", "123456");
      } catch { }
      expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    });

    it("does NOT call jwtService.generateToken when verification fails", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(false);
      try {
        await authService.verifyOtp("alice@stu.cu.edu.ng", "123456");
      } catch { }
      expect(mockJwt.generateToken).not.toHaveBeenCalled();
    });
  });

  // ------- Group 5: verifyOtp success + user lifecycle -------

  describe("verifyOtp success + user lifecycle", () => {
    beforeEach(() => resetMocks());

    it("calls Prisma.user.upsert with normalized email as where/create key", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser());
      mockJwt.generateToken.mockReturnValue("token123");

      await authService.verifyOtp("  ALICE@stu.cu.edu.ng  ", "123456");

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
        where: { email: "alice@stu.cu.edu.ng" },
        update: {},
        create: { email: "alice@stu.cu.edu.ng" },
      });
    });

    it("calls jwtService.generateToken with { sub, email, role } from upserted user", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      const user = makeUser({ id: "u_123", email: "bob@stu.cu.edu.ng", role: "MERCHANT" });
      mockPrisma.user.upsert.mockResolvedValue(user);
      mockJwt.generateToken.mockReturnValue("token123");

      await authService.verifyOtp("bob@stu.cu.edu.ng", "123456");

      expect(mockJwt.generateToken).toHaveBeenCalledWith({
        sub: "u_123",
        email: "bob@stu.cu.edu.ng",
        role: "MERCHANT",
        pubKeyRegistered: false,
      });
    });

    it("returns { accessToken: <value> }", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser());
      mockJwt.generateToken.mockReturnValue("super.secret.token");

      const result = await authService.verifyOtp("alice@stu.cu.edu.ng", "123456");
      expect(result).toEqual({ accessToken: "super.secret.token" });
    });

    it("handles newly created user (status PENDING_VERIFICATION)", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      const newUser = makeUser({ status: "PENDING_VERIFICATION", role: "STUDENT" });
      mockPrisma.user.upsert.mockResolvedValue(newUser);
      mockJwt.generateToken.mockReturnValue("token_new");

      const result = await authService.verifyOtp("new@stu.cu.edu.ng", "123456");
      expect(result.accessToken).toBe("token_new");
    });

    it("handles existing user (status ACTIVE)", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      const existingUser = makeUser({ status: "ACTIVE", role: "STUDENT" });
      mockPrisma.user.upsert.mockResolvedValue(existingUser);
      mockJwt.generateToken.mockReturnValue("token_exist");

      const result = await authService.verifyOtp("exist@stu.cu.edu.ng", "123456");
      expect(result.accessToken).toBe("token_exist");
    });
  });

  // ------- Group 6: verifyOtp account status gating -------

  describe("verifyOtp account status gating", () => {
    beforeEach(() => resetMocks());

    it("throws ForbiddenException when status is FROZEN", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser({ status: "FROZEN" }));

      await expect(authService.verifyOtp("frozen@stu.cu.edu.ng", "123456")).rejects.toThrow(ForbiddenException);
      await expect(authService.verifyOtp("frozen@stu.cu.edu.ng", "123456")).rejects.toThrow("Account is frozen");
    });

    it("throws ForbiddenException when status is FLAGGED", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser({ status: "FLAGGED" }));

      await expect(authService.verifyOtp("flagged@stu.cu.edu.ng", "123456")).rejects.toThrow(ForbiddenException);
      await expect(authService.verifyOtp("flagged@stu.cu.edu.ng", "123456")).rejects.toThrow("Account requires review");
    });

    it("does NOT call jwtService.generateToken when account is FROZEN or FLAGGED", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);

      mockPrisma.user.upsert.mockResolvedValueOnce(makeUser({ status: "FROZEN" }));
      try { await authService.verifyOtp("frozen@stu.cu.edu.ng", "123456"); } catch { }

      mockPrisma.user.upsert.mockResolvedValueOnce(makeUser({ status: "FLAGGED" }));
      try { await authService.verifyOtp("flagged@stu.cu.edu.ng", "123456"); } catch { }

      expect(mockJwt.generateToken).not.toHaveBeenCalled();
    });

    it("allows PENDING_VERIFICATION status", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser({ status: "PENDING_VERIFICATION" }));
      mockJwt.generateToken.mockReturnValue("token_pending");

      const result = await authService.verifyOtp("pending@stu.cu.edu.ng", "123456");
      expect(result.accessToken).toBe("token_pending");
    });

    it("allows ACTIVE status", async () => {
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.upsert.mockResolvedValue(makeUser({ status: "ACTIVE" }));
      mockJwt.generateToken.mockReturnValue("token_active");

      const result = await authService.verifyOtp("active@stu.cu.edu.ng", "123456");
      expect(result.accessToken).toBe("token_active");
    });
  });

  // ------- Group 7: admin defense-in-depth -------

  describe("admin defense-in-depth", () => {
    beforeEach(() => resetMocks());

    it("requestOtp for an ADMIN-role email returns success but does NOT call the OTP channel send method", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN" }));

      await expect(authService.requestOtp("admin@getoneto.internal")).resolves.toBeUndefined();

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "admin@getoneto.internal" },
        select: { role: true },
      });
      expect(mockOtpStore.checkAndRecordRequest).not.toHaveBeenCalled();
      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("verifyOtp for an ADMIN-role email rejects with the standard \"invalid OTP\" error even if an OTP somehow exists", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN" }));
      mockOtpStore.verifyOtp.mockResolvedValue(true);

      await expect(authService.verifyOtp("admin@getoneto.internal", "123456")).rejects.toThrow(UnauthorizedException);
      await expect(authService.verifyOtp("admin@getoneto.internal", "123456")).rejects.toThrow("Invalid or expired code");

      expect(mockOtpStore.verifyOtp).not.toHaveBeenCalled();
    });

    it("requestOtp for a STUDENT-role email still works normally", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "STUDENT" }));

      await authService.requestOtp("alice@stu.cu.edu.ng");

      expect(mockOtpProvider.sendOtp).toHaveBeenCalledTimes(1);
      expect(mockOtpStore.checkAndRecordRequest).toHaveBeenCalledWith(
        "alice@stu.cu.edu.ng" as unknown as E164,
      );
    });

    it("requestOtp for a non-existent email still works normally", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await authService.requestOtp("nobody@stu.cu.edu.ng");

      expect(mockOtpProvider.sendOtp).toHaveBeenCalledTimes(1);
    });

    it("public auth still blocks ADMIN and does not use OTP store namespace for admin users", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN" }));

      await expect(authService.requestOtp("admin@getoneto.internal")).resolves.toBeUndefined();
      await expect(authService.verifyOtp("admin@getoneto.internal", "123456")).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockOtpStore.checkAndRecordRequest).not.toHaveBeenCalled();
      expect(mockOtpStore.verifyOtp).not.toHaveBeenCalled();
    });
  });

  // ------- Group 8: dedicated admin OTP auth -------

  describe("dedicated admin OTP auth", () => {
    beforeEach(() => resetMocks());

    it("admin OTP request with malformed email returns generic success and sends no OTP", async () => {
      await expect(authService.requestAdminOtp("not-an-email")).resolves.toBeUndefined();

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockOtpStore.checkAndRecordRequest).not.toHaveBeenCalled();
      expect(mockOtpStore.saveOtp).not.toHaveBeenCalled();
      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("admin OTP request for unknown email returns generic success and sends no OTP", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.requestAdminOtp("unknown@getoneto.com")).resolves.toBeUndefined();
      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("admin OTP request for STUDENT returns generic success and sends no OTP", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "STUDENT", status: "ACTIVE" }));

      await expect(authService.requestAdminOtp("student@getoneto.com")).resolves.toBeUndefined();
      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("admin OTP request for MERCHANT returns generic success and sends no OTP", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "MERCHANT", status: "ACTIVE" }));

      await expect(authService.requestAdminOtp("merchant@getoneto.com")).resolves.toBeUndefined();
      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("admin OTP request for FROZEN/FLAGGED ADMIN returns generic success and sends no OTP", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ role: "ADMIN", status: "FROZEN" }),
      );
      await expect(authService.requestAdminOtp("frozen-admin@getoneto.com")).resolves.toBeUndefined();

      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ role: "ADMIN", status: "FLAGGED" }),
      );
      await expect(authService.requestAdminOtp("flagged-admin@getoneto.com")).resolves.toBeUndefined();

      expect(mockOtpProvider.sendOtp).not.toHaveBeenCalled();
    });

    it("admin OTP request for ACTIVE ADMIN sends OTP and returns generic success", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN", status: "ACTIVE" }));

      await expect(authService.requestAdminOtp("active-admin@getoneto.com")).resolves.toBeUndefined();
      expect(mockOtpStore.checkAndRecordRequest).toHaveBeenCalledWith(
        "admin:active-admin@getoneto.com" as unknown as E164,
      );
      expect(mockOtpStore.saveOtp).toHaveBeenCalledTimes(1);
      expect(mockOtpStore.saveOtp).toHaveBeenCalledWith(
        "admin:active-admin@getoneto.com" as unknown as E164,
        expect.any(String),
      );
      expect(mockOtpProvider.sendOtp).toHaveBeenCalledTimes(1);
    });

    it("admin OTP request stores OTP under admin:email namespace", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN", status: "ACTIVE" }));

      await authService.requestAdminOtp("ADMIN@GETONETO.COM");

      expect(mockOtpStore.checkAndRecordRequest).toHaveBeenCalledWith(
        "admin:admin@getoneto.com" as unknown as E164,
      );
      expect(mockOtpStore.saveOtp).toHaveBeenCalledWith(
        "admin:admin@getoneto.com" as unknown as E164,
        expect.any(String),
      );
    });

    it("admin OTP verify rejects unknown email generically", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.verifyAdminOtp("unknown@getoneto.com", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.verifyAdminOtp("unknown@getoneto.com", "123456")).rejects.toThrow(
        "Invalid or expired code",
      );
    });

    it("admin OTP verify with malformed email returns generic unauthorized", async () => {
      await expect(authService.verifyAdminOtp("not-an-email", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.verifyAdminOtp("not-an-email", "123456")).rejects.toThrow(
        "Invalid or expired code",
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockOtpStore.verifyOtp).not.toHaveBeenCalled();
    });

    it("admin OTP verify rejects non-admin generically", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "STUDENT", status: "ACTIVE" }));

      await expect(authService.verifyAdminOtp("student@getoneto.com", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockOtpStore.verifyOtp).not.toHaveBeenCalled();
    });

    it("admin OTP verify rejects inactive admin generically", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN", status: "FROZEN" }));

      await expect(authService.verifyAdminOtp("frozen-admin@getoneto.com", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockOtpStore.verifyOtp).not.toHaveBeenCalled();
    });

    it("admin OTP verify rejects wrong/expired OTP generically", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ role: "ADMIN", status: "ACTIVE" }));
      mockOtpStore.verifyOtp.mockResolvedValue(false);

      await expect(authService.verifyAdminOtp("active-admin@getoneto.com", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.verifyAdminOtp("active-admin@getoneto.com", "123456")).rejects.toThrow(
        "Invalid or expired code",
      );
    });

    it("admin OTP verify succeeds for ACTIVE ADMIN with valid OTP and returns ADMIN JWT", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({
          id: "u_admin0000000001",
          email: "active-admin@getoneto.com",
          role: "ADMIN",
          status: "ACTIVE",
          publicKey: "ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      );
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockJwt.generateToken.mockReturnValue("admin.token");

      const result = await authService.verifyAdminOtp("active-admin@getoneto.com", "123456");

      expect(result).toEqual({ accessToken: "admin.token" });
      expect(mockJwt.generateToken).toHaveBeenCalledWith({
        sub: "u_admin0000000001",
        email: "active-admin@getoneto.com",
        role: "ADMIN",
        pubKeyRegistered: true,
      });
      expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    });

    it("admin OTP verify checks OTP under admin:email namespace", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({
          id: "u_admin0000000002",
          email: "admin-two@getoneto.com",
          role: "ADMIN",
          status: "ACTIVE",
          publicKey: null,
        }),
      );
      mockOtpStore.verifyOtp.mockResolvedValue(true);
      mockJwt.generateToken.mockReturnValue("admin.two.token");

      await authService.verifyAdminOtp("ADMIN-TWO@GETONETO.COM", "123456");

      expect(mockOtpStore.verifyOtp).toHaveBeenCalledWith(
        "admin:admin-two@getoneto.com" as unknown as E164,
        "123456",
      );
    });
  });
});
