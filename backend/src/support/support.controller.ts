import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { UserThrottlerGuard } from "../common/user-throttler.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { SupportService } from "./support.service";
import {
  CreateSupportTicketDto,
  CreateSupportTicketSchema,
} from "./support.schemas";

@Controller("support")
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post("tickets")
  @UseGuards(JwtAuthGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  async createTicket(
    @Body(new ZodValidationPipe(CreateSupportTicketSchema))
    body: CreateSupportTicketDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated user context");
    }

    return this.supportService.createTicket(userId, body);
  }
}
