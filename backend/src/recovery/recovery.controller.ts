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
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { UserThrottlerGuard } from "../common/user-throttler.guard";
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
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300000 } })
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
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
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
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60000 } })
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
