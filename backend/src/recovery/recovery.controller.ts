import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RecoveryService } from "./recovery.service";
import {
  CreateRecoveryRequestDto,
  CreateRecoveryRequestSchema,
  RecoveryIdParamDto,
  RecoveryIdParamSchema,
} from "./recovery.schemas";

@Controller("recovery")
@UseGuards(JwtAuthGuard)
export class RecoveryController {
  constructor(private readonly recoveryService: RecoveryService) {}

  @Post("request")
  async createRecoveryRequest(
    @Body(new ZodValidationPipe(CreateRecoveryRequestSchema))
    body: CreateRecoveryRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated user context");
    }

    return this.recoveryService.createRecoveryRequest(userId, body);
  }

  @Get("status")
  async getRecoveryStatus(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated user context");
    }

    return {
      recoveryRequest: await this.recoveryService.getLatestRecoveryStatus(userId),
    };
  }

  @Post(":id/cancel")
  async cancelRecoveryRequest(
    @Param(new ZodValidationPipe(RecoveryIdParamSchema))
    params: RecoveryIdParamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated user context");
    }

    return this.recoveryService.cancelRecoveryRequest(userId, params.id);
  }
}
