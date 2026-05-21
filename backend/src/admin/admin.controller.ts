import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AdminService } from "./admin.service";
import { CashoutService } from "../cashout/cashout.service";
import { RecoveryService } from "../recovery/recovery.service";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/role.guard";
import { AdminCookieSessionGuard } from "../auth/admin-cookie-session.guard";
import { AdminCsrfGuard } from "../auth/admin-csrf.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  ApproveRecoveryRequestDto,
  ApproveRecoveryRequestSchema,
  RecoveryIdParamDto,
  RecoveryIdParamSchema,
  RejectRecoveryRequestDto,
  RejectRecoveryRequestSchema,
} from "../recovery/recovery.schemas";
import {
  AdminMerchantUserIdParamDto,
  AdminMerchantUserIdParamSchema,
  CreateAdminMerchantDto,
  CreateAdminMerchantSchema,
  UpdateAdminMerchantDto,
  UpdateAdminMerchantSchema,
} from "./admin.schemas";

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
    private readonly recoveryService: RecoveryService,
  ) {}

  @Get("overview")
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get("merchants/pending")
  async getPendingMerchants() {
    return { merchants: await this.adminService.getPendingMerchants() };
  }

  @Get("merchants")
  async listMerchants() {
    return { merchants: await this.adminService.listMerchants() };
  }

  @Post("merchants")
  async createMerchant(
    @Body(new ZodValidationPipe(CreateAdminMerchantSchema))
    body: CreateAdminMerchantDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.adminService.createMerchant(body, adminUserId);
  }

  @Post("merchants/:userId/approve")
  async approveMerchant(
    @Param(new ZodValidationPipe(AdminMerchantUserIdParamSchema))
    params: AdminMerchantUserIdParamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.adminService.approveMerchant(params.userId, adminUserId);
  }

  @Patch("merchants/:userId")
  async updateMerchant(
    @Param(new ZodValidationPipe(AdminMerchantUserIdParamSchema))
    params: AdminMerchantUserIdParamDto,
    @Body(new ZodValidationPipe(UpdateAdminMerchantSchema))
    body: UpdateAdminMerchantDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.adminService.updateMerchant(params.userId, body, adminUserId);
  }

  @Post("merchants/:userId/deactivate")
  async deactivateMerchant(
    @Param(new ZodValidationPipe(AdminMerchantUserIdParamSchema))
    params: AdminMerchantUserIdParamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.adminService.deactivateMerchant(params.userId, adminUserId);
  }

  @Post("merchants/:userId/reactivate")
  async reactivateMerchant(
    @Param(new ZodValidationPipe(AdminMerchantUserIdParamSchema))
    params: AdminMerchantUserIdParamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.adminService.reactivateMerchant(params.userId, adminUserId);
  }

  @Get("cashouts/pending")
  async getPendingCashouts() {
    return { cashouts: await this.adminService.getPendingCashouts() };
  }

  @Get("recovery/pending")
  async getPendingRecoveryRequests() {
    return {
      recoveryRequests: await this.recoveryService.listPendingRecoveryRequests(),
    };
  }

  @Post("recovery/:id/approve")
  async approveRecoveryRequest(
    @Param(new ZodValidationPipe(RecoveryIdParamSchema))
    params: RecoveryIdParamDto,
    @Body(new ZodValidationPipe(ApproveRecoveryRequestSchema))
    body: ApproveRecoveryRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.recoveryService.approveRecoveryRequest(
      params.id,
      adminUserId,
      body,
    );
  }

  @Post("recovery/:id/reject")
  async rejectRecoveryRequest(
    @Param(new ZodValidationPipe(RecoveryIdParamSchema))
    params: RecoveryIdParamDto,
    @Body(new ZodValidationPipe(RejectRecoveryRequestSchema))
    body: RejectRecoveryRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminUserId = req.user?.sub;
    if (!adminUserId) {
      throw new UnauthorizedException("Missing authenticated admin context");
    }

    return this.recoveryService.rejectRecoveryRequest(
      params.id,
      adminUserId,
      body,
    );
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
