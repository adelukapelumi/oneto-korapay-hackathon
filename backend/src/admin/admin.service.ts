import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CashoutStatus, Role, Status } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const OPERATING_USER_ID = "u_operating";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const [
      totalUsers,
      activeUsers,
      activeStudents,
      activeMerchants,
      pendingMerchants,
      pendingCashouts,
      flaggedUsers,
      frozenUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: Status.ACTIVE } }),
      this.prisma.user.count({
        where: {
          status: Status.ACTIVE,
          role: Role.STUDENT,
        },
      }),
      this.prisma.user.count({
        where: {
          role: Role.MERCHANT,
          status: Status.ACTIVE,
          merchantProfile: { is: { verifiedAt: { not: null } } },
        },
      }),
      this.prisma.user.count({
        where: {
          role: Role.MERCHANT,
          status: Status.PENDING_VERIFICATION,
          merchantProfile: { is: { verifiedAt: null } },
        },
      }),
      this.prisma.cashout.count({ where: { status: CashoutStatus.PENDING } }),
      this.prisma.user.count({ where: { status: Status.FLAGGED } }),
      this.prisma.user.count({ where: { status: Status.FROZEN } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      activeStudents,
      activeMerchants,
      pendingMerchants,
      pendingCashouts,
      flaggedUsers,
      frozenUsers,
    };
  }

  async getPendingMerchants() {
    const users = await this.prisma.user.findMany({
      where: {
        role: Role.MERCHANT,
        status: Status.PENDING_VERIFICATION,
        merchantProfile: { is: { verifiedAt: null } },
      },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        merchantProfile: {
          select: {
            businessName: true,
            businessAddress: true,
            verifiedAt: true,
            cashoutBankName: true,
            cashoutBankCode: true,
            cashoutAccountNumber: true,
            cashoutAccountName: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return users.map((user) => ({
      userId: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      status: user.status,
      businessName: user.merchantProfile?.businessName ?? null,
      businessAddress: user.merchantProfile?.businessAddress ?? null,
      verifiedAt: user.merchantProfile?.verifiedAt?.toISOString() ?? null,
      cashoutBankName: user.merchantProfile?.cashoutBankName ?? null,
      cashoutBankCode: user.merchantProfile?.cashoutBankCode ?? null,
      cashoutAccountNumber: user.merchantProfile?.cashoutAccountNumber ?? null,
      cashoutAccountName: user.merchantProfile?.cashoutAccountName ?? null,
    }));
  }

  async approveMerchant(userId: string, adminUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { merchantProfile: true },
      });

      if (!user) {
        throw new NotFoundException("merchant_user_not_found");
      }
      if (user.role !== Role.MERCHANT) {
        throw new ConflictException("user_is_not_merchant");
      }
      if (!user.merchantProfile) {
        throw new ConflictException("merchant_profile_missing");
      }
      if (user.status !== Status.PENDING_VERIFICATION) {
        throw new ConflictException("merchant_not_pending_verification");
      }
      if (user.merchantProfile.verifiedAt !== null) {
        throw new ConflictException("merchant_already_approved");
      }

      const verifiedAt = new Date();

      await tx.user.update({
        where: { id: user.id },
        data: { status: Status.ACTIVE },
      });

      await tx.merchantProfile.update({
        where: { userId: user.id },
        data: { verifiedAt },
      });

      return {
        userId: user.id,
        status: Status.ACTIVE,
        verifiedAt: verifiedAt.toISOString(),
      };
    });

    this.logger.log(
      `Admin approved merchant userId=${result.userId} by adminUserId=${adminUserId}`,
    );

    return result;
  }

  async getPendingCashouts() {
    const cashouts = await this.prisma.cashout.findMany({
      where: { status: CashoutStatus.PENDING },
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        merchantUserId: true,
        amountKobo: true,
        requestedAt: true,
        status: true,
        cashoutBankName: true,
        cashoutBankCode: true,
        cashoutAccountNumber: true,
        cashoutAccountName: true,
        merchant: {
          select: {
            merchantProfile: {
              select: {
                businessName: true,
              },
            },
          },
        },
      },
    });

    return cashouts.map((cashout) => ({
      id: cashout.id,
      merchantUserId: cashout.merchantUserId,
      merchantBusinessName: cashout.merchant.merchantProfile?.businessName ?? null,
      amountKobo: cashout.amountKobo.toString(),
      requestedAt: cashout.requestedAt.toISOString(),
      status: cashout.status,
      cashoutBankName: cashout.cashoutBankName,
      cashoutBankCode: cashout.cashoutBankCode,
      cashoutAccountNumber: cashout.cashoutAccountNumber,
      cashoutAccountName: cashout.cashoutAccountName,
    }));
  }

  async getReconciliationReport() {
    const [sumResult, operatingUser] = await Promise.all([
      this.prisma.user.aggregate({ _sum: { verifiedBalanceKobo: true } }),
      this.prisma.user.findUnique({
        where: { id: OPERATING_USER_ID },
        select: { verifiedBalanceKobo: true },
      }),
    ]);

    const sumAllVerifiedBalancesKobo = (
      sumResult._sum.verifiedBalanceKobo ?? 0n
    ).toString();

    const operatingBalanceKobo = operatingUser
      ? operatingUser.verifiedBalanceKobo.toString()
      : null;

    const invariantPasses =
      (sumResult._sum.verifiedBalanceKobo ?? 0n) === 0n;

    return {
      sumAllVerifiedBalancesKobo,
      operatingBalanceKobo,
      operatingAccountPresent: operatingUser !== null,
      invariantPasses,
      generatedAt: new Date().toISOString(),
    };
  }
}
