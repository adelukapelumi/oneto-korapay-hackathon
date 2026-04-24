import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";

interface AuthedRequest {
  user: { sub: string; email: string; role: string };
}

@Controller("me")
export class MeController {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * GET /me
   * Returns the authenticated user's profile and verified balance.
   * Safe fields only — no public key, no internal flags.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: AuthedRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        verifiedBalanceKobo: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException("user_not_found");
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      verifiedBalanceKobo: user.verifiedBalanceKobo.toString(),
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * GET /me/ledger?cursor=<createdAt>&limit=<n>
   * Returns paginated ledger entries for the authenticated user,
   * newest first. Uses cursor-based pagination on createdAt.
   */
  @Get("ledger")
  @UseGuards(JwtAuthGuard)
  async getLedger(
    @Req() req: AuthedRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException("limit_out_of_range");
    }

    let cursorDate: Date | undefined;
    if (cursor) {
      const parsed = new Date(cursor);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException("invalid_cursor");
      }
      cursorDate = parsed;
    }

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        userId: req.user.sub,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: parsedLimit + 1, // Fetch one extra to determine if there's a next page.
      select: {
        id: true,
        transactionId: true,
        type: true,
        amountKobo: true,
        balanceAfterKobo: true,
        description: true,
        createdAt: true,
      },
    });

    const hasMore = entries.length > parsedLimit;
    const page = hasMore ? entries.slice(0, parsedLimit) : entries;

    return {
      entries: page.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        type: e.type,
        amountKobo: e.amountKobo.toString(),
        balanceAfterKobo: e.balanceAfterKobo.toString(),
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }
}