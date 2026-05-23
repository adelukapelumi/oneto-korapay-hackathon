import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CashoutStatus, Prisma, Role, Status } from "@prisma/client";
import { InvalidEmailError, normalizeEmail } from "../common/email";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateAdminMerchantDto,
  UpdateAdminMerchantDto,
} from "./admin.schemas";
import { generateOnetoUserId } from "../common/user-id";

const OPERATING_USER_ID = "u_operating";
const ADMIN_MERCHANT_SELECT = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  merchantProfile: {
    select: {
      businessName: true,
      businessAddress: true,
      cashoutBankName: true,
      cashoutBankCode: true,
      cashoutAccountNumber: true,
      cashoutAccountName: true,
      verifiedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

type AdminMerchantRecord = Prisma.UserGetPayload<{
  select: typeof ADMIN_MERCHANT_SELECT;
}>;

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
        grossAmountKobo: true,
        onetoFeeBps: true,
        onetoFeeKobo: true,
        korapayPayoutFeeKobo: true,
        netPayoutKobo: true,
        finalPayoutAmountKobo: true,
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
      grossAmountKobo: (cashout.grossAmountKobo ?? cashout.amountKobo).toString(),
      onetoFeeBps: cashout.onetoFeeBps,
      onetoFeeKobo: cashout.onetoFeeKobo?.toString() ?? null,
      korapayPayoutFeeKobo: cashout.korapayPayoutFeeKobo?.toString() ?? null,
      netPayoutKobo: cashout.netPayoutKobo?.toString() ?? null,
      finalPayoutAmountKobo: cashout.finalPayoutAmountKobo?.toString() ?? null,
      requestedAt: cashout.requestedAt.toISOString(),
      status: cashout.status,
      cashoutBankName: cashout.cashoutBankName,
      cashoutBankCode: cashout.cashoutBankCode,
      cashoutAccountNumber: cashout.cashoutAccountNumber,
      cashoutAccountName: cashout.cashoutAccountName,
    }));
  }

  async listMerchants() {
    const merchants = await this.prisma.user.findMany({
      where: {
        role: Role.MERCHANT,
      },
      select: ADMIN_MERCHANT_SELECT,
      orderBy: [{ createdAt: "desc" }],
    });

    return merchants.map((merchant) => this.mapAdminMerchant(merchant));
  }

  async createMerchant(input: CreateAdminMerchantDto, adminUserId: string) {
    const normalizedEmail = this.normalizeMerchantEmail(input.email);
    const verifiedAt = new Date();

    try {
      const merchant = await this.prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        });

        if (existingUser) {
          throw new ConflictException("email_already_registered");
        }

        return tx.user.create({
          data: {
            id: generateOnetoUserId(),
            email: normalizedEmail,
            role: Role.MERCHANT,
            status: Status.ACTIVE,
            merchantProfile: {
              create: {
                businessName: input.businessName,
                businessAddress: input.businessAddress,
                cashoutBankName: input.cashoutBankName,
                cashoutBankCode: input.cashoutBankCode,
                cashoutAccountNumber: input.cashoutAccountNumber,
                cashoutAccountName: input.cashoutAccountName,
                verifiedAt,
              },
            },
          },
          select: ADMIN_MERCHANT_SELECT,
        });
      });

      this.logger.log(
        `Admin created merchant userId=${merchant.id} by adminUserId=${adminUserId}`,
      );

      return { merchant: this.mapAdminMerchant(merchant) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("email_already_registered");
      }

      throw error;
    }
  }

  async updateMerchant(
    userId: string,
    input: UpdateAdminMerchantDto,
    adminUserId: string,
  ) {
    const merchantUserId = this.requireMerchantUserId(userId);
    const profileUpdateData = this.buildMerchantProfileUpdateData(input);

    const merchant = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { id: merchantUserId },
        include: { merchantProfile: true },
      });

      this.assertMerchantWithProfile(existingUser);

      await tx.merchantProfile.update({
        where: { userId: merchantUserId },
        data: profileUpdateData,
      });

      const updatedUser = await tx.user.findUnique({
        where: { id: merchantUserId },
        select: ADMIN_MERCHANT_SELECT,
      });

      if (!updatedUser) {
        throw new NotFoundException("merchant_user_not_found");
      }

      return updatedUser;
    });

    this.logger.log(
      `Admin updated merchant userId=${merchantUserId} by adminUserId=${adminUserId} fields=${Object.keys(profileUpdateData)
        .sort()
        .join(",")}`,
    );

    return { merchant: this.mapAdminMerchant(merchant) };
  }

  async deactivateMerchant(userId: string, adminUserId: string) {
    const merchantUserId = this.requireMerchantUserId(userId);
    const existingUser = await this.prisma.user.findUnique({
      where: { id: merchantUserId },
      include: { merchantProfile: true },
    });

    this.assertMerchantWithProfile(existingUser);

    if (existingUser.status === Status.FLAGGED) {
      throw new ConflictException("flagged_merchant_requires_review_flow");
    }

    if (existingUser.status !== Status.FROZEN) {
      // Freezing a verified merchant is enough to hide them from student payment
      // selection because /merchants/list only returns ACTIVE verified merchants.
      await this.prisma.user.update({
        where: { id: merchantUserId },
        data: { status: Status.FROZEN },
      });
    }

    this.logger.log(
      `Admin deactivated merchant userId=${merchantUserId} by adminUserId=${adminUserId}`,
    );

    return {
      userId: merchantUserId,
      status: Status.FROZEN,
    };
  }

  async reactivateMerchant(userId: string, adminUserId: string) {
    const merchantUserId = this.requireMerchantUserId(userId);
    const existingUser = await this.prisma.user.findUnique({
      where: { id: merchantUserId },
      include: { merchantProfile: true },
    });

    this.assertMerchantWithProfile(existingUser);

    if (existingUser.status === Status.FLAGGED) {
      throw new ConflictException("flagged_merchant_requires_review_flow");
    }

    if (existingUser.merchantProfile.verifiedAt === null) {
      throw new ConflictException("merchant_not_verified");
    }

    if (existingUser.status !== Status.ACTIVE) {
      await this.prisma.user.update({
        where: { id: merchantUserId },
        data: { status: Status.ACTIVE },
      });
    }

    this.logger.log(
      `Admin reactivated merchant userId=${merchantUserId} by adminUserId=${adminUserId}`,
    );

    return {
      userId: merchantUserId,
      status: Status.ACTIVE,
      verifiedAt: existingUser.merchantProfile.verifiedAt.toISOString(),
    };
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

  private mapAdminMerchant(user: AdminMerchantRecord) {
    return {
      userId: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      businessName: user.merchantProfile?.businessName ?? null,
      businessAddress: user.merchantProfile?.businessAddress ?? null,
      cashoutBankName: user.merchantProfile?.cashoutBankName ?? null,
      cashoutBankCode: user.merchantProfile?.cashoutBankCode ?? null,
      cashoutAccountNumber: user.merchantProfile?.cashoutAccountNumber ?? null,
      cashoutAccountName: user.merchantProfile?.cashoutAccountName ?? null,
      verifiedAt: user.merchantProfile?.verifiedAt?.toISOString() ?? null,
    };
  }

  private requireMerchantUserId(userId: string): string {
    const trimmedUserId = userId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("merchant_user_id_required");
    }

    return trimmedUserId;
  }

  private normalizeMerchantEmail(email: string): string {
    try {
      return normalizeEmail(email);
    } catch (error) {
      if (error instanceof InvalidEmailError) {
        throw new BadRequestException("invalid_email");
      }

      throw error;
    }
  }

  private assertMerchantWithProfile(
    user:
      | {
          id: string;
          role: Role;
          merchantProfile: {
            verifiedAt: Date | null;
          } | null;
          status?: Status;
        }
      | null,
  ): asserts user is {
    id: string;
    role: Role;
    merchantProfile: {
      verifiedAt: Date | null;
    };
    status?: Status;
  } {
    if (!user) {
      throw new NotFoundException("merchant_user_not_found");
    }

    if (user.role !== Role.MERCHANT) {
      throw new ConflictException("user_is_not_merchant");
    }

    if (!user.merchantProfile) {
      throw new ConflictException("merchant_profile_missing");
    }
  }

  private buildMerchantProfileUpdateData(input: UpdateAdminMerchantDto) {
    const data: Prisma.MerchantProfileUpdateInput = {};

    if (input.businessName !== undefined) {
      data.businessName = input.businessName;
    }
    if (input.businessAddress !== undefined) {
      data.businessAddress = input.businessAddress;
    }
    if (input.cashoutBankName !== undefined) {
      data.cashoutBankName = input.cashoutBankName;
    }
    if (input.cashoutBankCode !== undefined) {
      data.cashoutBankCode = input.cashoutBankCode;
    }
    if (input.cashoutAccountNumber !== undefined) {
      data.cashoutAccountNumber = input.cashoutAccountNumber;
    }
    if (input.cashoutAccountName !== undefined) {
      data.cashoutAccountName = input.cashoutAccountName;
    }

    return data;
  }
}
