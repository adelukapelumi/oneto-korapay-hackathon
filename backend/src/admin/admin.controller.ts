import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/role.guard";
import { AdminCookieSessionGuard } from "../auth/admin-cookie-session.guard";
import { AdminCsrfGuard } from "../auth/admin-csrf.guard";

@Controller("admin")
@UseGuards(
  JwtAuthGuard,
  RolesGuard(["ADMIN"]),
  AdminCookieSessionGuard,
  AdminCsrfGuard,
)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly cashoutService: CashoutService,
  ) {}

  @Get("overview")
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get("merchants/pending")
  async getPendingMerchants() {
    return { merchants: await this.adminService.getPendingMerchants() };
  }

  @Post("merchants/:userId/approve")
  async approveMerchant(
    @Param("userId") userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }
    return this.adminService.approveMerchant(userId, adminUserId);
  }

  @Get("cashouts/pending")
  async getPendingCashouts() {
    return { cashouts: await this.adminService.getPendingCashouts() };
  }

  @Post("cashouts/:id/approve")
  async approveCashout(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }
    return this.cashoutService.approveCashout(id, adminUserId);
  }

  @Get("reconciliation-report")
  async getReconciliationReport() {
    return this.adminService.getReconciliationReport();
  }
}
