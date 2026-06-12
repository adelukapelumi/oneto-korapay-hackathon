import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DeviceKeyStatus,
  KeyRecoveryReason,
  KeyRecoveryRequest,
  KeyRecoveryRiskType,
  KeyRecoveryStatus,
  Prisma,
  RecoveryBalanceHoldStatus,
  Role,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApproveRecoveryRequestDto,
  CreateRecoveryRequestDto,
  RejectRecoveryRequestDto,
} from "./recovery.schemas";
import { RecoveryEmailService } from "./recovery-email.service";

export const RECOVERY_VERIFY_ONLY_WINDOW_MS = 48 * 60 * 60 * 1000;

const ADMIN_PENDING_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      verifiedBalanceKobo: true,
    },
  },
  oldKey: {
    select: {
      id: true,
      publicKey: true,
      status: true,
      validFrom: true,
      retiredAt: true,
      verifyUntil: true,
    },
  },
} satisfies Prisma.KeyRecoveryRequestInclude;

type AdminPendingRecoveryRecord = Prisma.KeyRecoveryRequestGetPayload<{
  include: typeof ADMIN_PENDING_INCLUDE;
}>;

export interface PublicRecoveryRequestResponse {
  id: string;
  userId: string;
  oldKeyId: string;
  requestedNewPublicKey: string;
  status: KeyRecoveryStatus;
  riskType: KeyRecoveryRiskType;
  reason: string;
  userNotes: string | null;
  approximateBalanceKobo: string | null;
  lastMerchantText: string | null;
  lastTopupAmountKobo: string | null;
  reviewedAt: string | null;
  decisionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRecoveryRequestResponse extends PublicRecoveryRequestResponse {
  reviewedByUserId: string | null;
  user: {
    id: string;
    email: string;
    role: Role;
    status: string;
    verifiedBalanceKobo: string;
  };
  oldKey: {
    id: string;
    publicKey: string;
    status: DeviceKeyStatus;
    validFrom: string;
    retiredAt: string | null;
    verifyUntil: string | null;
  };
}

type RecoveryEmailContext = {
  readonly requestId: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: Role;
  readonly reason: KeyRecoveryReason;
  readonly riskType: KeyRecoveryRiskType;
  readonly oldKeyPublicKey: string;
  readonly requestedNewPublicKey: string;
  readonly approximateBalanceKobo: string | null;
  readonly lastMerchantText: string | null;
  readonly lastTopupAmountKobo: string | null;
  readonly userNotes: string | null;
};

type RecoveryRequestRecord = KeyRecoveryRequest & {
  userEmail: string;
  userRole: Role;
  oldKeyPublicKey: string;
};

function isStolenOrCompromisedRecovery(input: {
  readonly reason: KeyRecoveryReason;
  readonly riskType: KeyRecoveryRiskType;
}): boolean {
  return (
    input.reason === KeyRecoveryReason.STOLEN_PHONE ||
    input.riskType === KeyRecoveryRiskType.COMPROMISED_DEVICE
  );
}

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recoveryEmailService: RecoveryEmailService,
  ) {}

  async createRecoveryRequest(userId: string, input: CreateRecoveryRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException("user_not_found");
    }

    const existingPending = await this.findPendingRequest(userId);
    if (existingPending) {
      return this.mapPublicRequest(existingPending);
    }

    const activeKey = await this.prisma.userDeviceKey.findFirst({
      where: { userId, status: DeviceKeyStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });

    if (!activeKey) {
      throw new ConflictException("active_device_key_required");
    }

    if (input.requestedNewPublicKey === activeKey.publicKey) {
      throw new ConflictException("requested_key_matches_active_key");
    }

    const existingPublicKey = await this.prisma.userDeviceKey.findUnique({
      where: { publicKey: input.requestedNewPublicKey },
      select: { id: true },
    });

    if (existingPublicKey) {
      throw new ConflictException("requested_key_already_registered");
    }

    try {
      const createdAt = new Date();
      const request = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.keyRecoveryRequest.create({
            data: {
              userId,
              oldKeyId: activeKey.id,
              requestedNewPublicKey: input.requestedNewPublicKey,
              riskType: input.riskType,
              reason: input.reason,
              userNotes: input.userNotes,
              approximateBalanceKobo:
                input.approximateBalanceKobo === undefined
                  ? undefined
                  : BigInt(input.approximateBalanceKobo),
              lastMerchantText: input.lastMerchantText,
              lastTopupAmountKobo:
                input.lastTopupAmountKobo === undefined
                  ? undefined
                  : BigInt(input.lastTopupAmountKobo),
              createdAt,
            },
          });

          if (isStolenOrCompromisedRecovery(input)) {
            // High-risk reports must stop the old key from authorizing new
            // payments immediately. VERIFY_ONLY keeps already-scanned pre-report
            // envelopes reconcilable while rejecting anything signed later.
            await tx.userDeviceKey.update({
              where: { id: activeKey.id },
              data: {
                status: DeviceKeyStatus.VERIFY_ONLY,
                retiredAt: createdAt,
                verifyUntil: new Date(createdAt.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS),
              },
            });
          }

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await this.notifySafely("recovery_request_notification_failed", async () => {
        const emailContext = this.toEmailContext({
          request,
          userEmail: user.email,
          userRole: user.role,
          oldKeyPublicKey: activeKey.publicKey,
        });
        await this.recoveryEmailService.sendAdminNewRecoveryRequestNotification(emailContext);
        await this.recoveryEmailService.sendUserRecoveryRequestReceived(emailContext);
      });

      return this.mapPublicRequest(request);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const pending = await this.findPendingRequest(userId);
        if (pending) {
          return this.mapPublicRequest(pending);
        }
      }

      throw error;
    }
  }

  async getLatestRecoveryStatus(userId: string) {
    const request = await this.prisma.keyRecoveryRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return request ? this.mapPublicRequest(request) : null;
  }

  async cancelRecoveryRequest(userId: string, requestId: string) {
    const request = await this.prisma.keyRecoveryRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("recovery_request_not_found");
    }

    if (request.userId !== userId) {
      throw new ForbiddenException("cannot_cancel_another_users_recovery_request");
    }

    if (request.status !== KeyRecoveryStatus.PENDING) {
      throw new ConflictException("only_pending_recovery_requests_can_be_cancelled");
    }

    const cancelled = await this.prisma.keyRecoveryRequest.update({
      where: { id: requestId },
      data: { status: KeyRecoveryStatus.CANCELLED },
    });

    return this.mapPublicRequest(cancelled);
  }

  async listPendingRecoveryRequests() {
    const requests = await this.prisma.keyRecoveryRequest.findMany({
      where: { status: KeyRecoveryStatus.PENDING },
      orderBy: { createdAt: "asc" },
      include: ADMIN_PENDING_INCLUDE,
    });

    return requests.map((request) => this.mapAdminRequest(request));
  }

  async approveRecoveryRequest(
    requestId: string,
    adminUserId: string,
    input: ApproveRecoveryRequestDto,
  ) {
    await this.assertAdminUser(adminUserId);

    try {
      const approved = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.keyRecoveryRequest.findUnique({
            where: { id: requestId },
          });

          if (!request) {
            throw new NotFoundException("recovery_request_not_found");
          }

          if (request.status !== KeyRecoveryStatus.PENDING) {
            throw new ConflictException("recovery_request_not_pending");
          }

          const oldKey = await tx.userDeviceKey.findUnique({
            where: { id: request.oldKeyId },
          });

          if (!oldKey || oldKey.userId !== request.userId) {
            throw new ConflictException("old_device_key_not_found");
          }

          const duplicateKey = await tx.userDeviceKey.findUnique({
            where: { publicKey: request.requestedNewPublicKey },
            select: { id: true },
          });

          if (duplicateKey) {
            throw new ConflictException("requested_key_already_registered");
          }

          const reviewedAt = new Date();
          const oldKeyUpdate = this.buildOldKeyApprovalUpdate(request, oldKey, reviewedAt);
          const requestUserBalance = await tx.user.findUnique({
            where: { id: request.userId },
            select: { verifiedBalanceKobo: true, email: true, role: true },
          });

          if (!requestUserBalance) {
            throw new ConflictException("recovery_request_user_not_found");
          }

          await tx.userDeviceKey.update({
            where: { id: oldKey.id },
            data: oldKeyUpdate,
          });

          // Approval is the first point where the pending key becomes trusted.
          await tx.userDeviceKey.create({
            data: {
              userId: request.userId,
              publicKey: request.requestedNewPublicKey,
              status: DeviceKeyStatus.ACTIVE,
              validFrom: reviewedAt,
            },
          });

          await tx.user.update({
            where: { id: request.userId },
            data: { publicKey: request.requestedNewPublicKey },
          });

          const updatedRequest = await tx.keyRecoveryRequest.update({
            where: { id: request.id },
            data: {
              status: KeyRecoveryStatus.APPROVED,
              reviewedByUserId: adminUserId,
              reviewedAt,
              decisionNotes: input.decisionNotes,
            },
          });

          if (requestUserBalance.verifiedBalanceKobo > 0n) {
            await tx.recoveryBalanceHold.create({
              data: {
                userId: request.userId,
                recoveryRequestId: request.id,
                oldKeyId: request.oldKeyId,
                status: RecoveryBalanceHoldStatus.ACTIVE,
                heldAmountKobo: requestUserBalance.verifiedBalanceKobo,
                consumedAmountKobo: 0n,
                holdUntil: new Date(
                  reviewedAt.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS,
                ),
              },
            });
          }

          return {
            ...updatedRequest,
            userEmail: requestUserBalance.email,
            userRole: requestUserBalance.role,
            oldKeyPublicKey: oldKey.publicKey,
          } satisfies RecoveryRequestRecord;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await this.notifySafely("recovery_approved_notification_failed", async () => {
        await this.recoveryEmailService.sendUserRecoveryApproved(
          this.toEmailContext(approved),
        );
      });

      return this.mapPublicRequest(approved);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("recovery_approval_conflict");
      }

      throw error;
    }
  }

  async rejectRecoveryRequest(
    requestId: string,
    adminUserId: string,
    input: RejectRecoveryRequestDto,
  ) {
    await this.assertAdminUser(adminUserId);

    const rejected = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.keyRecoveryRequest.findUnique({
          where: { id: requestId },
        });

        if (!request) {
          throw new NotFoundException("recovery_request_not_found");
        }

        if (request.status !== KeyRecoveryStatus.PENDING) {
          throw new ConflictException("recovery_request_not_pending");
        }

        const oldKey = await tx.userDeviceKey.findUnique({
          where: { id: request.oldKeyId },
        });

        if (!oldKey || oldKey.userId !== request.userId) {
          throw new ConflictException("old_device_key_not_found");
        }

        if (isStolenOrCompromisedRecovery(request) && oldKey.status === DeviceKeyStatus.VERIFY_ONLY) {
          // Do not auto-reactivate high-risk old keys. If a stolen or
          // compromised-device report turns out to be wrong, support must make a
          // deliberate manual decision instead of silently restoring trust.
        }

        const updatedRequest = await tx.keyRecoveryRequest.update({
          where: { id: request.id },
          data: {
            status: KeyRecoveryStatus.REJECTED,
            reviewedByUserId: adminUserId,
            reviewedAt: new Date(),
            decisionNotes: input.decisionNotes,
          },
        });

        const requestUser = await tx.user.findUnique({
          where: { id: request.userId },
          select: { email: true, role: true },
        });

        if (!requestUser) {
          throw new ConflictException("recovery_request_user_not_found");
        }

        return {
          ...updatedRequest,
          userEmail: requestUser.email,
          userRole: requestUser.role,
          oldKeyPublicKey: oldKey.publicKey,
        } satisfies RecoveryRequestRecord;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.notifySafely("recovery_rejected_notification_failed", async () => {
      await this.recoveryEmailService.sendUserRecoveryRejected(
        this.toEmailContext(rejected),
      );
    });

    return this.mapPublicRequest(rejected);
  }

  private buildOldKeyApprovalUpdate(
    request: KeyRecoveryRequest,
    oldKey: {
      status: DeviceKeyStatus;
      retiredAt: Date | null;
      verifyUntil: Date | null;
    },
    reviewedAt: Date,
  ): Prisma.UserDeviceKeyUpdateInput {
    if (isStolenOrCompromisedRecovery(request)) {
      if (oldKey.status !== DeviceKeyStatus.VERIFY_ONLY || oldKey.retiredAt === null) {
        throw new ConflictException("compromised_old_device_key_not_restricted");
      }

      return {
        status: DeviceKeyStatus.VERIFY_ONLY,
        retiredAt: oldKey.retiredAt,
        verifyUntil:
          oldKey.verifyUntil ?? new Date(oldKey.retiredAt.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS),
      };
    }

    if (oldKey.status !== DeviceKeyStatus.ACTIVE) {
      throw new ConflictException("old_device_key_not_active");
    }

    return {
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: reviewedAt,
      verifyUntil: new Date(reviewedAt.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS),
    };
  }

  private async findPendingRequest(userId: string) {
    return this.prisma.keyRecoveryRequest.findFirst({
      where: { userId, status: KeyRecoveryStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
  }

  private async assertAdminUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user || user.role !== Role.ADMIN) {
      throw new ForbiddenException("admin_required");
    }
  }

  private async notifySafely(
    logCode: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        `${logCode}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toEmailContext(input: {
    readonly request: KeyRecoveryRequest;
    readonly userEmail: string;
    readonly userRole: Role;
    readonly oldKeyPublicKey: string;
  }): RecoveryEmailContext;
  private toEmailContext(input: RecoveryRequestRecord): RecoveryEmailContext;
  private toEmailContext(
    input:
      | {
          readonly request: KeyRecoveryRequest;
          readonly userEmail: string;
          readonly userRole: Role;
          readonly oldKeyPublicKey: string;
        }
      | RecoveryRequestRecord,
  ): RecoveryEmailContext {
    const request = "request" in input ? input.request : input;
    const userEmail = "request" in input ? input.userEmail : input.userEmail;
    const userRole = "request" in input ? input.userRole : input.userRole;
    const oldKeyPublicKey =
      "request" in input ? input.oldKeyPublicKey : input.oldKeyPublicKey;

    return {
      requestId: request.id,
      userId: request.userId,
      userEmail,
      userRole,
      reason: request.reason,
      riskType: request.riskType,
      oldKeyPublicKey,
      requestedNewPublicKey: request.requestedNewPublicKey,
      approximateBalanceKobo:
        request.approximateBalanceKobo === null
          ? null
          : request.approximateBalanceKobo.toString(),
      lastMerchantText: request.lastMerchantText,
      lastTopupAmountKobo:
        request.lastTopupAmountKobo === null
          ? null
          : request.lastTopupAmountKobo.toString(),
      userNotes: request.userNotes,
    };
  }

  private mapPublicRequest(
    request: KeyRecoveryRequest,
  ): PublicRecoveryRequestResponse {
    return {
      id: request.id,
      userId: request.userId,
      oldKeyId: request.oldKeyId,
      requestedNewPublicKey: request.requestedNewPublicKey,
      status: request.status,
      riskType: request.riskType,
      reason: request.reason,
      userNotes: request.userNotes,
      approximateBalanceKobo:
        request.approximateBalanceKobo === null
          ? null
          : request.approximateBalanceKobo.toString(),
      lastMerchantText: request.lastMerchantText,
      lastTopupAmountKobo:
        request.lastTopupAmountKobo === null
          ? null
          : request.lastTopupAmountKobo.toString(),
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      decisionNotes: request.decisionNotes,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  private mapAdminRequest(
    request: AdminPendingRecoveryRecord,
  ): AdminRecoveryRequestResponse {
    return {
      ...this.mapPublicRequest(request),
      reviewedByUserId: request.reviewedByUserId,
      user: {
        id: request.user.id,
        email: request.user.email,
        role: request.user.role,
        status: request.user.status,
        verifiedBalanceKobo: request.user.verifiedBalanceKobo.toString(),
      },
      oldKey: {
        id: request.oldKey.id,
        publicKey: request.oldKey.publicKey,
        status: request.oldKey.status,
        validFrom: request.oldKey.validFrom.toISOString(),
        retiredAt: request.oldKey.retiredAt?.toISOString() ?? null,
        verifyUntil: request.oldKey.verifyUntil?.toISOString() ?? null,
      },
    };
  }
}
