import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/role.guard";

interface AuthedRequest {
  user: { sub: string };
}

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard(["ADMIN"]))
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
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.approveMerchant(userId, req.user.sub);
  }

  @Get("cashouts/pending")
  async getPendingCashouts() {
    return { cashouts: await this.adminService.getPendingCashouts() };
  }

  @Post("cashouts/:id/approve")
  async approveCashout(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.cashoutService.approveCashout(id, req.user.sub);
  }

  @Get("reconciliation-report")
  async getReconciliationReport() {
    return this.adminService.getReconciliationReport();
  }
}

