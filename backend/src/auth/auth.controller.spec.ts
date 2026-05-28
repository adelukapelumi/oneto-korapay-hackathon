import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { AuthController } from "./auth.controller";
import { AdminCookieSessionGuard } from "./admin-cookie-session.guard";
import { AdminCsrfGuard } from "./admin-csrf.guard";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtWrapperService } from "./jwt.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_MS,
} from "./admin-session.constants";
import type { AuthenticatedRequest } from "./jwt-auth.guard";

describe("AuthController", () => {
  let controller: AuthController;
  let reflector: Reflector;

  const mockAuthService = {
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    requestAdminOtp: jest.fn(),
    verifyAdminOtp: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };
  let mockNodeEnv = "development";

  function makeResponse(): Pick<Response, "cookie" | "clearCookie"> {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockNodeEnv = "development";
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") {
        return mockNodeEnv;
      }
      if (key === "ADMIN_WEB_ORIGINS") {
        return undefined;
      }
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtWrapperService, useValue: { verifyToken: jest.fn() } },
        { provide: PrismaService, useValue: { user: { findUnique: jest.fn() } } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    reflector = module.get<Reflector>(Reflector);
  });

  it("admin OTP verify sets HttpOnly admin session cookie and does not return accessToken", async () => {
    const response = makeResponse();
    mockNodeEnv = "production";
    mockAuthService.verifyAdminOtp.mockResolvedValue({ accessToken: "admin.jwt" });

    const result = await controller.verifyAdminOtp(
      { email: "admin@getoneto.com", code: "123456" },
      response as Response,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE_NAME,
      "admin.jwt",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: true,
        maxAge: ADMIN_SESSION_MAX_AGE_MS,
      }),
    );
    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("accessToken");
  });

  it("uses cookie-only admin guard stack for GET /auth/admin/session", () => {
    const methodGuards = Reflect.getMetadata(
      "__guards__",
      AuthController.prototype.getAdminSession,
    ) as Array<unknown> | undefined;

    expect(methodGuards).toBeDefined();
    expect(methodGuards).toContain(JwtAuthGuard);
    expect(methodGuards).toContain(AdminCookieSessionGuard);
    expect(methodGuards).toHaveLength(3);
  });

  it("admin OTP verify uses non-secure cookie outside production", async () => {
    const response = makeResponse();
    mockNodeEnv = "development";
    mockAuthService.verifyAdminOtp.mockResolvedValue({ accessToken: "admin.jwt.dev" });

    await controller.verifyAdminOtp(
      { email: "admin@getoneto.com", code: "123456" },
      response as Response,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE_NAME,
      "admin.jwt.dev",
      expect.objectContaining({
        secure: false,
      }),
    );
  });

  it("uses cookie-only admin guard stack for POST /auth/admin/logout", () => {
    const methodGuards = Reflect.getMetadata(
      "__guards__",
      AuthController.prototype.adminLogout,
    ) as Array<unknown> | undefined;

    expect(methodGuards).toBeDefined();
    expect(methodGuards).toContain(JwtAuthGuard);
    expect(methodGuards).toContain(AdminCookieSessionGuard);
    expect(methodGuards).toContain(AdminCsrfGuard);
    expect(methodGuards).toHaveLength(4);
  });

  it("admin logout clears session cookie and returns success", async () => {
    const response = makeResponse();

    const result = await controller.adminLogout(response as Response);

    expect(response.clearCookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it("admin session endpoint returns safe metadata without token", async () => {
    const req = {
      user: {
        sub: "u_admin",
        email: "admin@getoneto.com",
        role: "ADMIN",
        pubKeyRegistered: false,
      },
    };

    const result = await controller.getAdminSession(req as unknown as AuthenticatedRequest);

    expect(result).toEqual({
      authenticated: true,
      admin: {
        id: "u_admin",
        email: "admin@getoneto.com",
        role: "ADMIN",
      },
    });
    expect(result).not.toHaveProperty("accessToken");
    expect(result.admin).not.toHaveProperty("token");
  });

  it("applies strict throttle to public /auth/otp/request", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.requestOtp);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.requestOtp);
    expect(limit).toBe(6);
    expect(ttl).toBe(60000);
  });

  it("applies strict throttle to public /auth/otp/verify", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.verifyOtp);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.verifyOtp);
    expect(limit).toBe(12);
    expect(ttl).toBe(60000);
  });
});
