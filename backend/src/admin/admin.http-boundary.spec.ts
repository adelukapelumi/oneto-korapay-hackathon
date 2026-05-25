import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { RecoveryService } from "../recovery/recovery.service";
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
    listMerchants: jest.fn(),
    createMerchant: jest.fn(),
    getPendingMerchants: jest.fn(),
    approveMerchant: jest.fn(),
    updateMerchant: jest.fn(),
    deactivateMerchant: jest.fn(),
    reactivateMerchant: jest.fn(),
    getPendingCashouts: jest.fn(),
    getOutboundIpDiagnostic: jest.fn(),
    getReconciliationReport: jest.fn(),
  };

  const mockCashoutService = {
    approveCashout: jest.fn(),
  };

  const mockRecoveryService = {
    listPendingRecoveryRequests: jest.fn(),
    approveRecoveryRequest: jest.fn(),
    rejectRecoveryRequest: jest.fn(),
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
    mockAdminService.listMerchants.mockResolvedValue([{ userId: "u_merchant" }]);
    mockAdminService.createMerchant.mockResolvedValue({
      merchant: { userId: "u_new_merchant", status: "ACTIVE" },
    });
    mockAdminService.approveMerchant.mockResolvedValue({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
    mockAdminService.updateMerchant.mockResolvedValue({
      merchant: { userId: "u_merchant", businessName: "Updated Cafe" },
    });
    mockAdminService.getOutboundIpDiagnostic.mockResolvedValue({
      ipv4: "203.0.113.10",
      auto: "2001:db8::10",
      checkedAt: "2026-05-25T00:00:00.000Z",
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        JwtAuthGuard,
        AdminCookieSessionGuard,
        AdminCsrfGuard,
        { provide: AdminService, useValue: mockAdminService },
        { provide: CashoutService, useValue: mockCashoutService },
        { provide: RecoveryService, useValue: mockRecoveryService },
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

  it("accepts GET /admin/merchants with admin session cookie", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/merchants")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual({ merchants: [{ userId: "u_merchant" }] });
    expect(mockAdminService.listMerchants).toHaveBeenCalledTimes(1);
  });

  it("rejects GET /admin/network/outbound-ip with Bearer ADMIN token", async () => {
    await request(app.getHttpServer())
      .get("/admin/network/outbound-ip")
      .set("Authorization", `Bearer ${BEARER_ADMIN_TOKEN}`)
      .expect(401);

    expect(mockAdminService.getOutboundIpDiagnostic).not.toHaveBeenCalled();
  });

  it("accepts GET /admin/network/outbound-ip with admin session cookie", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/network/outbound-ip")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual({
      ipv4: "203.0.113.10",
      auto: "2001:db8::10",
      checkedAt: "2026-05-25T00:00:00.000Z",
    });
    expect(mockAdminService.getOutboundIpDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("rejects POST /admin/merchants without admin CSRF header", async () => {
    await request(app.getHttpServer())
      .post("/admin/merchants")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .set("Origin", ALLOWED_ORIGIN)
      .send({
        email: "merchant@getoneto.com",
        businessName: "Campus Cafe",
        cashoutBankName: "Wema Bank",
        cashoutBankCode: "035",
        cashoutAccountNumber: "1234567890",
        cashoutAccountName: "Campus Cafe Ltd",
      })
      .expect(403);

    expect(mockAdminService.createMerchant).not.toHaveBeenCalled();
  });

  it("allows POST /admin/merchants with cookie auth, allowlisted Origin and CSRF header", async () => {
    const response = await request(app.getHttpServer())
      .post("/admin/merchants")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .set("Origin", ALLOWED_ORIGIN)
      .set("X-Oneto-Admin-CSRF", "1")
      .send({
        email: "merchant@getoneto.com",
        businessName: "Campus Cafe",
        cashoutBankName: "Wema Bank",
        cashoutBankCode: "035",
        cashoutAccountNumber: "1234567890",
        cashoutAccountName: "Campus Cafe Ltd",
      })
      .expect(201);

    expect(response.body).toEqual({
      merchant: { userId: "u_new_merchant", status: "ACTIVE" },
    });
    expect(mockAdminService.createMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "merchant@getoneto.com",
        businessName: "Campus Cafe",
      }),
      ADMIN_PAYLOAD.sub,
    );
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

  it("allows PATCH /admin/merchants/:userId with cookie auth, allowlisted Origin and CSRF header", async () => {
    const response = await request(app.getHttpServer())
      .patch("/admin/merchants/u_merchant")
      .set("Cookie", `${ADMIN_SESSION_COOKIE_NAME}=${COOKIE_ADMIN_TOKEN}`)
      .set("Origin", ALLOWED_ORIGIN)
      .set("X-Oneto-Admin-CSRF", "1")
      .send({ businessName: "Updated Cafe" })
      .expect(200);

    expect(response.body).toEqual({
      merchant: { userId: "u_merchant", businessName: "Updated Cafe" },
    });
    expect(mockAdminService.updateMerchant).toHaveBeenCalledWith(
      "u_merchant",
      { businessName: "Updated Cafe" },
      ADMIN_PAYLOAD.sub,
    );
  });
});
