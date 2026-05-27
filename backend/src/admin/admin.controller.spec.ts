import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { RecoveryService } from "../recovery/recovery.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtWrapperService } from "../auth/jwt.service";
import { RolesGuard } from "../auth/role.guard";
import { AdminCookieSessionGuard } from "../auth/admin-cookie-session.guard";
import { AdminCsrfGuard } from "../auth/admin-csrf.guard";
import { AuthenticatedRequest } from "../auth/jwt-auth.guard";

describe("AdminController", () => {
  let controller: AdminController;
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
    getCashoutOperations: jest.fn(),
    getOutboundIpDiagnostic: jest.fn(),
    getReconciliationReport: jest.fn(),
  };

  const mockCashoutService = {
    approveCashout: jest.fn(),
    markManualCashoutPaid: jest.fn(),
    cancelManualCashout: jest.fn(),
  };

  const mockRecoveryService = {
    listPendingRecoveryRequests: jest.fn(),
    approveRecoveryRequest: jest.fn(),
    rejectRecoveryRequest: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: CashoutService, useValue: mockCashoutService },
        { provide: RecoveryService, useValue: mockRecoveryService },
        { provide: JwtWrapperService, useValue: { verifyToken: jest.fn() } },
        { provide: PrismaService, useValue: { user: { findUnique: jest.fn() } } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === "ADMIN_WEB_ORIGINS" ? undefined : "test",
            ),
          },
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    jest.clearAllMocks();
  });

  it("uses JwtAuthGuard, role guard, cookie guard and csrf guard on admin routes", () => {
    const classGuards = Reflect.getMetadata("__guards__", AdminController);
    expect(classGuards).toBeDefined();
    expect(classGuards).toContain(JwtAuthGuard);
    expect(classGuards).toContain(AdminCookieSessionGuard);
    expect(classGuards).toContain(AdminCsrfGuard);
    expect(classGuards.length).toBe(4);
  });

  it("non-admin role guard denies access", () => {
    const RoleGuardCtor = RolesGuard(["ADMIN"]);
    const roleGuard = new RoleGuardCtor();

    const fakeContext = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: "STUDENT" } }),
      }),
    } as any;

    expect(() => roleGuard.canActivate(fakeContext)).toThrow(
      "Insufficient permissions",
    );
  });

  it("admin role guard allows access", () => {
    const RoleGuardCtor = RolesGuard(["ADMIN"]);
    const roleGuard = new RoleGuardCtor();

    const fakeContext = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: "ADMIN" } }),
      }),
    } as any;

    expect(roleGuard.canActivate(fakeContext)).toBe(true);
  });

  it("delegates /admin/cashouts/:id/approve to CashoutService.approveCashout", async () => {
    mockCashoutService.approveCashout.mockResolvedValue({ success: true });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.approveCashout({ id: "cashout_1" }, req);

    expect(result).toEqual({ success: true });
    expect(mockCashoutService.approveCashout).toHaveBeenCalledWith(
      "cashout_1",
      "u_admin",
    );
  });

  it("delegates /admin/cashouts/:id/mark-paid to CashoutService.markManualCashoutPaid", async () => {
    mockCashoutService.markManualCashoutPaid.mockResolvedValue({ success: true });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.markCashoutPaid(
      { id: "cashout_1" },
      { externalReference: "bank_ref_123", note: "sent from ops account" },
      req,
    );

    expect(result).toEqual({ success: true });
    expect(mockCashoutService.markManualCashoutPaid).toHaveBeenCalledWith(
      "cashout_1",
      "u_admin",
      { externalReference: "bank_ref_123", note: "sent from ops account" },
    );
  });

  it("delegates /admin/cashouts/:id/cancel-manual to CashoutService.cancelManualCashout", async () => {
    mockCashoutService.cancelManualCashout.mockResolvedValue({ success: true });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.cancelManualCashout(
      { id: "cashout_1" },
      req,
    );

    expect(result).toEqual({ success: true });
    expect(mockCashoutService.cancelManualCashout).toHaveBeenCalledWith(
      "cashout_1",
      "u_admin",
    );
  });

  it("delegates /admin/merchants/:userId/approve to AdminService.approveMerchant", async () => {
    mockAdminService.approveMerchant.mockResolvedValue({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-14T00:00:00.000Z",
    });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.approveMerchant({ userId: "u_merchant" }, req);

    expect(result.userId).toBe("u_merchant");
    expect(mockAdminService.approveMerchant).toHaveBeenCalledWith(
      "u_merchant",
      "u_admin",
    );
  });

  it("delegates GET /admin/merchants to AdminService.listMerchants", async () => {
    mockAdminService.listMerchants.mockResolvedValue([{ userId: "u_merchant" }]);

    const result = await controller.listMerchants();

    expect(result).toEqual({ merchants: [{ userId: "u_merchant" }] });
    expect(mockAdminService.listMerchants).toHaveBeenCalledTimes(1);
  });

  it("delegates GET /admin/cashouts/operations to AdminService.getCashoutOperations", async () => {
    mockAdminService.getCashoutOperations.mockResolvedValue([{ id: "cash_1" }]);

    const result = await controller.getCashoutOperations();

    expect(result).toEqual({ cashouts: [{ id: "cash_1" }] });
    expect(mockAdminService.getCashoutOperations).toHaveBeenCalledTimes(1);
  });

  it("delegates GET /admin/network/outbound-ip to AdminService.getOutboundIpDiagnostic", async () => {
    mockAdminService.getOutboundIpDiagnostic.mockResolvedValue({
      ipv4: "203.0.113.10",
      auto: "2001:db8::10",
      checkedAt: "2026-05-25T00:00:00.000Z",
    });

    const result = await controller.getOutboundIpDiagnostic();

    expect(result).toEqual({
      ipv4: "203.0.113.10",
      auto: "2001:db8::10",
      checkedAt: "2026-05-25T00:00:00.000Z",
    });
    expect(mockAdminService.getOutboundIpDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("delegates POST /admin/merchants to AdminService.createMerchant", async () => {
    mockAdminService.createMerchant.mockResolvedValue({
      merchant: { userId: "u_merchant", status: "ACTIVE" },
    });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;
    const body = {
      email: "merchant@getoneto.com",
      businessName: "Campus Cafe",
      cashoutBankName: "Wema Bank",
      cashoutBankCode: "035",
      cashoutAccountNumber: "1234567890",
      cashoutAccountName: "Campus Cafe Ltd",
    };

    const result = await controller.createMerchant(body, req);

    expect(result).toEqual({
      merchant: { userId: "u_merchant", status: "ACTIVE" },
    });
    expect(mockAdminService.createMerchant).toHaveBeenCalledWith(body, "u_admin");
  });

  it("delegates PATCH /admin/merchants/:userId to AdminService.updateMerchant", async () => {
    mockAdminService.updateMerchant.mockResolvedValue({
      merchant: { userId: "u_merchant", businessName: "Updated Name" },
    });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;
    const params = { userId: "u_merchant" };
    const body = { businessName: "Updated Name" };

    const result = await controller.updateMerchant(params, body, req);

    expect(result).toEqual({
      merchant: { userId: "u_merchant", businessName: "Updated Name" },
    });
    expect(mockAdminService.updateMerchant).toHaveBeenCalledWith(
      "u_merchant",
      body,
      "u_admin",
    );
  });

  it("delegates POST /admin/merchants/:userId/deactivate to AdminService.deactivateMerchant", async () => {
    mockAdminService.deactivateMerchant.mockResolvedValue({
      userId: "u_merchant",
      status: "FROZEN",
    });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.deactivateMerchant(
      { userId: "u_merchant" },
      req,
    );

    expect(result).toEqual({ userId: "u_merchant", status: "FROZEN" });
    expect(mockAdminService.deactivateMerchant).toHaveBeenCalledWith(
      "u_merchant",
      "u_admin",
    );
  });

  it("delegates POST /admin/merchants/:userId/reactivate to AdminService.reactivateMerchant", async () => {
    mockAdminService.reactivateMerchant.mockResolvedValue({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
    const req = { user: { sub: "u_admin" } } as unknown as AuthenticatedRequest;

    const result = await controller.reactivateMerchant(
      { userId: "u_merchant" },
      req,
    );

    expect(result).toEqual({
      userId: "u_merchant",
      status: "ACTIVE",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
    expect(mockAdminService.reactivateMerchant).toHaveBeenCalledWith(
      "u_merchant",
      "u_admin",
    );
  });
});
