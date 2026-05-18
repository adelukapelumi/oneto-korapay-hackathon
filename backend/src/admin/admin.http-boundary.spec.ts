import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { ADMIN_SESSION_COOKIE_NAME } from "../auth/admin-session.constants";
import { AdminCookieSessionGuard } from "../auth/admin-cookie-session.guard";
import { AdminCsrfGuard } from "../auth/admin-csrf.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtWrapperService } from "../auth/jwt.service";

const ALLOWED_ORIGIN = "https://admin.getoneto.com";
const BEARER_ADMIN_TOKEN = "bearer-admin-token";
const COOKIE_ADMIN_TOKEN = "cookie-admin-token";

const ADMIN_PAYLOAD = {
  sub: "u_admin",
  email: "admin@getoneto.com",
  role: "ADMIN",
  pubKeyRegistered: false,
};

describe("Admin HTTP boundary", () => {
  let app: INestApplication;

  const mockAdminService = {
    getOverview: jest.fn(),
    getPendingMerchants: jest.fn(),
    approveMerchant: jest.fn(),
    getPendingCashouts: jest.fn(),
    getReconciliationReport: jest.fn(),
  };

  const mockCashoutService = {
    approveCashout: jest.fn(),
  };

  const mockJwtWrapperService = {
    verifyToken: jest.fn((token: string) => {
      if (token === BEARER_ADMIN_TOKEN || token === COOKIE_ADMIN_TOKEN) {
        return ADMIN_PAYLOAD;
      }
      throw new Error("invalid token");
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === "ADMIN_WEB_ORIGINS") {
        return ALLOWED_ORIGIN;
      }
      return "test";
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAdminService.getOverview.mockResolvedValue({ totalUsers: 10 });
    mockAdminService.approveMerchant.mockResolvedValue({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        JwtAuthGuard,
        AdminCookieSessionGuard,
        AdminCsrfGuard,
        { provide: AdminService, useValue: mockAdminService },
        { provide: CashoutService, useValue: mockCashoutService },
        { provide: JwtWrapperService, useValue: mockJwtWrapperService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects GET /admin/overview with Bearer ADMIN token", async () => {
    await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${BEARER_ADMIN_TOKEN}`)
      .expect(401);

    expect(mockAdminService.getOverview).not.toHaveBeenCalled();
  });

  it("accepts GET /admin/overview with admin session cookie", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual({ totalUsers: 10 });
    expect(mockAdminService.getOverview).toHaveBeenCalledTimes(1);
  });

  it("rejects POST /admin/merchants/:userId/approve without admin CSRF header", async () => {
    await request(app.getHttpServer())
      .post("/admin/merchants/u_merchant/approve")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .set("Origin", ALLOWED_ORIGIN)
      .expect(403);

    expect(mockAdminService.approveMerchant).not.toHaveBeenCalled();
  });

  it("allows POST /admin/merchants/:userId/approve with cookie auth, allowlisted Origin and CSRF header", async () => {
    const response = await request(app.getHttpServer())
      .post("/admin/merchants/u_merchant/approve")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .set("Origin", ALLOWED_ORIGIN)
      .set("X-Oneto-Admin-CSRF", "1")
      .expect(201);

    expect(response.body).toEqual({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
    expect(mockAdminService.approveMerchant).toHaveBeenCalledWith(
      "u_merchant",
      ADMIN_PAYLOAD.sub,
    );
  });
});
