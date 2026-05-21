import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DeviceKeyStatus,
  KeyRecoveryRequest,
  KeyRecoveryRiskType,
  KeyRecoveryStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApproveRecoveryRequestDto,
  CreateRecoveryRequestDto,
  RejectRecoveryRequestDto,
} from "./recovery.schemas";

const VERIFY_ONLY_WINDOW_MS = 24 * 60 * 60 * 1000;

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

@Injectable()
export class RecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async createRecoveryRequest(userId: string, input: CreateRecoveryRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException("user_not_found");
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

    const existingPending = await this.findPendingRequest(userId);
    if (existingPending) {
      return this.mapPublicRequest(existingPending);
    }

    try {
      const request = await this.prisma.keyRecoveryRequest.create({
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
        },
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

          if (!oldKey) {
            throw new ConflictException("old_device_key_not_found");
          }

          if (
            oldKey.userId !== request.userId ||
            oldKey.status !== DeviceKeyStatus.ACTIVE
          ) {
            throw new ConflictException("old_device_key_not_active");
          }

          const duplicateKey = await tx.userDeviceKey.findUnique({
            where: { publicKey: request.requestedNewPublicKey },
            select: { id: true },
          });

          if (duplicateKey) {
            throw new ConflictException("requested_key_already_registered");
          }

          const reviewedAt = new Date();
          const verifyUntil =
            request.riskType === KeyRecoveryRiskType.LOST_DEVICE
              ? new Date(reviewedAt.getTime() + VERIFY_ONLY_WINDOW_MS)
              : null;
          const oldKeyStatus =
            request.riskType === KeyRecoveryRiskType.LOST_DEVICE
              ? DeviceKeyStatus.VERIFY_ONLY
              : DeviceKeyStatus.REVOKED;

          // Recovery approval is the first point where a new key is trusted.
          await tx.userDeviceKey.update({
            where: { id: oldKey.id },
            data: {
              status: oldKeyStatus,
              retiredAt: reviewedAt,
              verifyUntil,
            },
          });

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

          return tx.keyRecoveryRequest.update({
            where: { id: request.id },
            data: {
              status: KeyRecoveryStatus.APPROVED,
              reviewedByUserId: adminUserId,
              reviewedAt,
              decisionNotes: input.decisionNotes,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

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

    const request = await this.prisma.keyRecoveryRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("recovery_request_not_found");
    }

    if (request.status !== KeyRecoveryStatus.PENDING) {
      throw new ConflictException("recovery_request_not_pending");
    }

    const rejected = await this.prisma.keyRecoveryRequest.update({
      where: { id: request.id },
      data: {
        status: KeyRecoveryStatus.REJECTED,
        reviewedByUserId: adminUserId,
        reviewedAt: new Date(),
        decisionNotes: input.decisionNotes,
      },
    });

    return this.mapPublicRequest(rejected);
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
