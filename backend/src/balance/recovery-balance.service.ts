import { Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  RecoveryBalanceHoldStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

export interface RecoveryBalanceSnapshot {
  readonly verifiedBalanceKobo: bigint;
  readonly activeRecoveryHeldBalanceKobo: bigint;
  readonly availableBalanceKobo: bigint;
  readonly recoveryHoldUntil: Date | null;
}

export interface ActiveRecoveryHoldRecord {
  readonly id: string;
  readonly userId: string;
  readonly oldKeyId: string;
  readonly heldAmountKobo: bigint;
  readonly consumedAmountKobo: bigint;
  readonly holdUntil: Date;
}

@Injectable()
export class RecoveryBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalanceSnapshot(
    userId: string,
    client: PrismaClientLike = this.prisma,
    now: Date = new Date(),
  ): Promise<RecoveryBalanceSnapshot> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { verifiedBalanceKobo: true },
    });

    if (!user) {
      throw new NotFoundException("user_not_found");
    }

    const activeHolds = await this.getActiveRecoveryHolds(userId, client, now);
    const activeRecoveryHeldBalanceKobo = activeHolds.reduce(
      (sum, hold) => sum + this.getRemainingHoldAmount(hold),
      0n,
    );

    return {
      verifiedBalanceKobo: user.verifiedBalanceKobo,
      activeRecoveryHeldBalanceKobo,
      availableBalanceKobo:
        user.verifiedBalanceKobo - activeRecoveryHeldBalanceKobo,
      recoveryHoldUntil:
        activeHolds.length === 0
          ? null
          : activeHolds.reduce(
              (latest, hold) =>
                hold.holdUntil > latest ? hold.holdUntil : latest,
              activeHolds[0]!.holdUntil,
            ),
    };
  }

  async getActiveRecoveryHolds(
    userId: string,
    client: PrismaClientLike = this.prisma,
    now: Date = new Date(),
  ): Promise<ActiveRecoveryHoldRecord[]> {
    const holds = await client.recoveryBalanceHold.findMany({
      where: {
        userId,
        status: RecoveryBalanceHoldStatus.ACTIVE,
        holdUntil: { gt: now },
      },
      select: {
        id: true,
        userId: true,
        oldKeyId: true,
        heldAmountKobo: true,
        consumedAmountKobo: true,
        holdUntil: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return holds.filter((hold) => this.getRemainingHoldAmount(hold) > 0n);
  }

  async getActiveHoldForOldKey(
    userId: string,
    oldKeyId: string,
    client: PrismaClientLike = this.prisma,
    now: Date = new Date(),
  ): Promise<ActiveRecoveryHoldRecord | null> {
    const holds = await client.recoveryBalanceHold.findMany({
      where: {
        userId,
        oldKeyId,
        status: RecoveryBalanceHoldStatus.ACTIVE,
        holdUntil: { gt: now },
      },
      select: {
        id: true,
        userId: true,
        oldKeyId: true,
        heldAmountKobo: true,
        consumedAmountKobo: true,
        holdUntil: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return holds.find((hold) => this.getRemainingHoldAmount(hold) > 0n) ?? null;
  }

  getRemainingHoldAmount(hold: {
    heldAmountKobo: bigint;
    consumedAmountKobo: bigint;
  }): bigint {
    const remaining = hold.heldAmountKobo - hold.consumedAmountKobo;
    return remaining > 0n ? remaining : 0n;
  }
}
