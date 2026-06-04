import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CashoutStatus, Prisma, Role, Status } from "@prisma/client";
import { z } from "zod";
import { InvalidEmailError, normalizeEmail } from "../common/email";
import { PrismaService } from "../prisma/prisma.service";
import {
  getCashoutPayoutMode,
  parseManualPayoutRequiredMetadata,
} from "../cashout/manual-payout-metadata";
import {
  CreateAdminMerchantDto,
  UpdateAdminMerchantDto,
} from "./admin.schemas";
import { generateOnetoUserId } from "../common/user-id";
import {
  KorapayGatewayError,
  KorapayService,
} from "../topup/korapay.service";

const OPERATING_USER_ID = "u_operating";
const OUTBOUND_IP_FETCH_TIMEOUT_MS = 5_000;
const OUTBOUND_IP_ENDPOINTS = {
  ipv4: "https://api.ipify.org?format=json",
  auto: "https://api64.ipify.org?format=json",
} as const;
const OutboundIpResponseSchema = z.object({
  ip: z.string().trim().min(1),
});

type OutboundIpDiagnostic = {
  ipv4: string | null;
  auto: string | null;
  checkedAt: string;
};
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
    private readonly configService?: ConfigService,
  ) {}

  async listBanks(countryCode: string = "NG") {
    try {
      const banks = await this.korapayService.listBanks(countryCode);

      return banks.map((bank) => ({
        name: bank.name,
        code: bank.code,
        countryCode: bank.countryCode,
      }));
    } catch (error) {
      if (error instanceof KorapayGatewayError) {
        this.logKorapayGatewayFailure("listBanks", error, {
          countryCode: countryCode.trim().toUpperCase(),
        });
        throw new BadGatewayException("korapay_bank_list_unavailable");
      }

      throw error;
    }
  }

  async resolveBankAccount(input: {
    bankCode: string;
    accountNumber: string;
  }) {
    try {
      const resolvedAccount = await this.korapayService.resolveBankAccount({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        currency: "NGN",
      });

      return {
        accountName: resolvedAccount.accountName,
        accountNumber: resolvedAccount.accountNumber,
        bankCode: resolvedAccount.bankCode,
        bankName: resolvedAccount.bankName,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof KorapayGatewayError) {
        this.logKorapayGatewayFailure("resolveBankAccount", error, {
          bankCode: input.bankCode.trim(),
          accountNumberLast4: input.accountNumber.trim().slice(-4),
        });

        if (this.isKorapayResolutionValidationFailure(error)) {
          throw new BadRequestException("unable_to_resolve_bank_account");
        }

        throw new BadGatewayException("korapay_bank_resolution_unavailable");
      }

      throw new BadRequestException("unable_to_resolve_bank_account");
    }
  }

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
        korapayPayoutFeeBearer: true,
        korapayPayoutFeeDeductedFromRecipient: true,
        netPayoutKobo: true,
        korapayTransferAmountKobo: true,
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
      korapayPayoutFeeBearer: cashout.korapayPayoutFeeBearer,
      korapayPayoutFeeDeductedFromRecipient:
        cashout.korapayPayoutFeeDeductedFromRecipient ?? null,
      netPayoutKobo: cashout.netPayoutKobo?.toString() ?? null,
      korapayTransferAmountKobo: cashout.korapayTransferAmountKobo?.toString() ?? null,
      requestedAt: cashout.requestedAt.toISOString(),
      status: cashout.status,
      cashoutBankName: cashout.cashoutBankName,
      cashoutBankCode: cashout.cashoutBankCode,
      cashoutAccountNumber: cashout.cashoutAccountNumber,
      cashoutAccountName: cashout.cashoutAccountName,
    }));
  }

  async getCashoutOperations() {
    const configuredPayoutMode = getCashoutPayoutMode(
      this.configService?.get<string>("CASHOUT_PAYOUT_MODE"),
    );

    const cashouts = await this.prisma.cashout.findMany({
      where: {
        status: {
          in: [CashoutStatus.PENDING, CashoutStatus.PROCESSING],
        },
      },
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        merchantUserId: true,
        amountKobo: true,
        grossAmountKobo: true,
        onetoFeeBps: true,
        onetoFeeKobo: true,
        korapayPayoutFeeKobo: true,
        korapayPayoutFeeBearer: true,
        korapayPayoutFeeDeductedFromRecipient: true,
        netPayoutKobo: true,
        korapayTransferAmountKobo: true,
        requestedAt: true,
        status: true,
        cashoutBankName: true,
        cashoutBankCode: true,
        cashoutAccountNumber: true,
        cashoutAccountName: true,
        korapayResponse: true,
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

    return cashouts
      .filter((cashout) => {
        if (cashout.status === CashoutStatus.PENDING) {
          return true;
        }

        return parseManualPayoutRequiredMetadata(cashout.korapayResponse) !== null;
      })
      .map((cashout) => {
        const manualMetadata = parseManualPayoutRequiredMetadata(cashout.korapayResponse);
        const payoutMode = manualMetadata?.payoutMode ?? configuredPayoutMode;

        return {
          id: cashout.id,
          merchantUserId: cashout.merchantUserId,
          merchantBusinessName: cashout.merchant.merchantProfile?.businessName ?? null,
          amountKobo: cashout.amountKobo.toString(),
          grossAmountKobo: (cashout.grossAmountKobo ?? cashout.amountKobo).toString(),
          onetoFeeBps: cashout.onetoFeeBps,
          onetoFeeKobo: cashout.onetoFeeKobo?.toString() ?? null,
          korapayPayoutFeeKobo: cashout.korapayPayoutFeeKobo?.toString() ?? null,
          korapayPayoutFeeBearer: cashout.korapayPayoutFeeBearer,
          korapayPayoutFeeDeductedFromRecipient:
            cashout.korapayPayoutFeeDeductedFromRecipient ?? null,
          netPayoutKobo: cashout.netPayoutKobo?.toString() ?? null,
          korapayTransferAmountKobo: cashout.korapayTransferAmountKobo?.toString() ?? null,
          amountToPayKobo:
            manualMetadata?.amountToPayKobo ?? cashout.korapayTransferAmountKobo?.toString() ?? null,
          payoutMode,
          manualPayoutRequired:
            payoutMode === "manual" && cashout.status === CashoutStatus.PROCESSING,
          requestedAt: cashout.requestedAt.toISOString(),
          status: cashout.status,
          cashoutBankName: cashout.cashoutBankName,
          cashoutBankCode: cashout.cashoutBankCode,
          cashoutAccountNumber: cashout.cashoutAccountNumber,
          cashoutAccountName: cashout.cashoutAccountName,
        };
      });
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
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException("email_already_registered");
    }

    const resolvedPayoutDetails = await this.resolveBankAccount({
      bankCode: input.cashoutBankCode,
      accountNumber: input.cashoutAccountNumber,
    });

    try {
      const merchant = await this.prisma.$transaction(async (tx) => {
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
                cashoutBankName: resolvedPayoutDetails.bankName,
                cashoutBankCode: resolvedPayoutDetails.bankCode,
                cashoutAccountNumber: resolvedPayoutDetails.accountNumber,
                cashoutAccountName: resolvedPayoutDetails.accountName,
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
    let updatedFieldNames: string[] = [];

    const merchant = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { id: merchantUserId },
        include: { merchantProfile: true },
      });

      this.assertMerchantWithProfile(existingUser);
      const profileUpdateData = await this.buildMerchantProfileUpdateData(
        input,
        existingUser.merchantProfile,
      );
      updatedFieldNames = Object.keys(profileUpdateData).sort();

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
      `Admin updated merchant userId=${merchantUserId} by adminUserId=${adminUserId} fields=${updatedFieldNames.join(",")}`,
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

  async getOutboundIpDiagnostic(): Promise<OutboundIpDiagnostic> {
    this.logger.log("Admin outbound IP diagnostic requested");

    if (!this.isOutboundIpDiagnosticEnabled()) {
      return {
        ipv4: null,
        auto: null,
        checkedAt: new Date().toISOString(),
      };
    }

    const [ipv4, auto] = await Promise.all([
      this.fetchOutboundIp(OUTBOUND_IP_ENDPOINTS.ipv4),
      this.fetchOutboundIp(OUTBOUND_IP_ENDPOINTS.auto),
    ]);

    return {
      ipv4,
      auto,
      checkedAt: new Date().toISOString(),
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

  private async buildMerchantProfileUpdateData(
    input: UpdateAdminMerchantDto,
    existingProfile: {
      cashoutBankName?: string | null;
      cashoutBankCode?: string | null;
      cashoutAccountNumber?: string | null;
      cashoutAccountName?: string | null;
    },
  ) {
    const data: Prisma.MerchantProfileUpdateInput = {};

    if (input.businessName !== undefined) {
      data.businessName = input.businessName;
    }
    if (input.businessAddress !== undefined) {
      data.businessAddress = input.businessAddress;
    }

    const payoutFieldTouched =
      input.cashoutBankName !== undefined ||
      input.cashoutBankCode !== undefined ||
      input.cashoutAccountNumber !== undefined ||
      input.cashoutAccountName !== undefined;

    if (payoutFieldTouched) {
      const bankCode =
        input.cashoutBankCode ?? existingProfile.cashoutBankCode ?? undefined;
      const accountNumber =
        input.cashoutAccountNumber ?? existingProfile.cashoutAccountNumber ?? undefined;

      if (!bankCode || !accountNumber) {
        throw new BadRequestException("unable_to_resolve_bank_account");
      }

      const resolvedPayoutDetails = await this.resolveBankAccount({
        bankCode,
        accountNumber,
      });

      data.cashoutBankName = resolvedPayoutDetails.bankName;
      data.cashoutBankCode = resolvedPayoutDetails.bankCode;
      data.cashoutAccountNumber = resolvedPayoutDetails.accountNumber;
      data.cashoutAccountName = resolvedPayoutDetails.accountName;
    }

    return data;
  }

  private isOutboundIpDiagnosticEnabled(): boolean {
    const rawFlag = this.configService?.get<string>(
      "ADMIN_OUTBOUND_IP_DIAGNOSTIC_ENABLED",
    );

    if (!rawFlag) {
      return true;
    }

    return rawFlag.trim().toLowerCase() !== "false";
  }

  private async fetchOutboundIp(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OUTBOUND_IP_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload: unknown = await response.json();
      const parsed = OutboundIpResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return null;
      }

      return parsed.data.ip;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isKorapayResolutionValidationFailure(
    error: KorapayGatewayError,
  ): boolean {
    if (error.category !== "http_error" || error.statusCode === null) {
      return false;
    }

    return [400, 404, 422].includes(error.statusCode);
  }

  private logKorapayGatewayFailure(
    operation: "listBanks" | "resolveBankAccount",
    error: KorapayGatewayError,
    context: Record<string, string>,
  ) {
    this.logger.error(
      JSON.stringify({
        operation,
        category: error.category,
        statusCode: error.statusCode,
        ...context,
      }),
    );
  }
}
