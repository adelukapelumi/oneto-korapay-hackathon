import { Test, TestingModule } from "@nestjs/testing";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtWrapperService } from "../auth/jwt.service";
import { RolesGuard } from "../auth/role.guard";

describe("AdminController", () => {
  let controller: AdminController;
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: CashoutService, useValue: mockCashoutService },
        { provide: JwtWrapperService, useValue: { verifyToken: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    jest.clearAllMocks();
  });

  it("uses JwtAuthGuard and role guard on admin routes", () => {
    const classGuards = Reflect.getMetadata("__guards__", AdminController);
    expect(classGuards).toBeDefined();
    expect(classGuards).toContain(JwtAuthGuard);
    expect(classGuards.length).toBe(2);
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

  it("delegates /admin/cashouts/:id/approve to CashoutService.approveCashout", async () => {
    mockCashoutService.approveCashout.mockResolvedValue({ success: true });
    const req = { user: { sub: "u_admin" } };

    const result = await controller.approveCashout("cashout_1", req);

    expect(result).toEqual({ success: true });
    expect(mockCashoutService.approveCashout).toHaveBeenCalledWith(
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
    const req = { user: { sub: "u_admin" } };

    const result = await controller.approveMerchant("u_merchant", req);

    expect(result.userId).toBe("u_merchant");
    expect(mockAdminService.approveMerchant).toHaveBeenCalledWith(
      "u_merchant",
      "u_admin",
    );
  });
});
