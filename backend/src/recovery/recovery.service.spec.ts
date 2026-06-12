import {
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import {
  DeviceKeyStatus,
  KeyRecoveryReason,
  KeyRecoveryRiskType,
  KeyRecoveryStatus,
  Role,
  Status,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RecoveryEmailService } from "./recovery-email.service";
import {
  RECOVERY_VERIFY_ONLY_WINDOW_MS,
  RecoveryService,
} from "./recovery.service";
import { RecoveryBalanceHoldStatus } from "@prisma/client";

type UserRecord = {
  id: string;
  email: string;
  role: Role;
  status: Status;
  publicKey: string | null;
  verifiedBalanceKobo: bigint;
};

type DeviceKeyRecord = {
  id: string;
  userId: string;
  publicKey: string;
  status: DeviceKeyStatus;
  validFrom: Date;
  retiredAt: Date | null;
  verifyUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RecoveryRequestRecord = {
  id: string;
  userId: string;
  oldKeyId: string;
  requestedNewPublicKey: string;
  status: KeyRecoveryStatus;
  riskType: KeyRecoveryRiskType;
  reason: KeyRecoveryReason;
  userNotes: string | null;
  approximateBalanceKobo: bigint | null;
  lastMerchantText: string | null;
  lastTopupAmountKobo: bigint | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  decisionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RecoveryBalanceHoldRecord = {
  id: string;
  userId: string;
  recoveryRequestId: string;
  oldKeyId: string;
  status: RecoveryBalanceHoldStatus;
  heldAmountKobo: bigint;
  consumedAmountKobo: bigint;
  holdUntil: Date;
  createdAt: Date;
  updatedAt: Date;
};

const NOW = new Date("2026-05-30T09:00:00.000Z");

const publicKey = (n: number) => `ed25519:${n.toString(16).padStart(64, "0")}`;

class PrismaMock {
  readonly users = new Map<string, UserRecord>();
  readonly deviceKeys = new Map<string, DeviceKeyRecord>();
  readonly recoveryRequests = new Map<string, RecoveryRequestRecord>();
  readonly recoveryBalanceHolds = new Map<string, RecoveryBalanceHoldRecord>();
  private keyCounter = 0;
  private requestCounter = 0;
  private holdCounter = 0;

  private syncKeyCounter(id: string) {
    const match = /^key-(\d+)$/.exec(id);
    if (!match) {
      return;
    }

    this.keyCounter = Math.max(this.keyCounter, Number(match[1]));
  }

  readonly user = {
    findUnique: jest.fn(async (args: { where: { id: string } }) => {
      const user = this.users.get(args.where.id) ?? null;
      if (!user) {
        return null;
      }
      return user;
    }),
    update: jest.fn(async (args: { where: { id: string }; data: Partial<UserRecord> }) => {
      const user = this.users.get(args.where.id);
      if (!user) {
        throw new Error("user missing");
      }
      const updated = { ...user, ...args.data };
      this.users.set(user.id, updated);
      return updated;
    }),
  };

  readonly userDeviceKey = {
    findFirst: jest.fn(
      async (args: {
        where: { userId?: string; status?: DeviceKeyStatus };
        orderBy?: { createdAt: "asc" | "desc" };
      }) => {
        const matches = [...this.deviceKeys.values()].filter((key) => {
          return (
            (args.where.userId === undefined || key.userId === args.where.userId) &&
            (args.where.status === undefined || key.status === args.where.status)
          );
        });
        const sorted = matches.sort((a, b) =>
          args.orderBy?.createdAt === "desc"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return sorted[0] ?? null;
      },
    ),
    findUnique: jest.fn(
      async (args: { where: { id?: string; publicKey?: string } }) => {
        if (args.where.id) {
          return this.deviceKeys.get(args.where.id) ?? null;
        }
        if (args.where.publicKey) {
          return (
            [...this.deviceKeys.values()].find(
              (key) => key.publicKey === args.where.publicKey,
            ) ?? null
          );
        }
        return null;
      },
    ),
    update: jest.fn(
      async (args: { where: { id: string }; data: Partial<DeviceKeyRecord> }) => {
        const key = this.deviceKeys.get(args.where.id);
        if (!key) {
          throw new Error("device key missing");
        }
        const updated = { ...key, ...args.data, updatedAt: new Date(NOW) };
        this.deviceKeys.set(key.id, updated);
        return updated;
      },
    ),
    create: jest.fn(
      async (args: {
        data: {
          userId: string;
          publicKey: string;
          status: DeviceKeyStatus;
          validFrom?: Date;
        };
      }) => {
        this.keyCounter += 1;
        const key: DeviceKeyRecord = {
          id: `key-${this.keyCounter}`,
          userId: args.data.userId,
          publicKey: args.data.publicKey,
          status: args.data.status,
          validFrom: args.data.validFrom ?? new Date(NOW),
          retiredAt: null,
          verifyUntil: null,
          createdAt: new Date(NOW),
          updatedAt: new Date(NOW),
        };
        this.deviceKeys.set(key.id, key);
        return key;
      },
    ),
  };

  readonly keyRecoveryRequest = {
    findFirst: jest.fn(
      async (args: {
        where: { userId?: string; status?: KeyRecoveryStatus };
        orderBy?: { createdAt: "asc" | "desc" };
      }) => {
        const matches = [...this.recoveryRequests.values()].filter((request) => {
          return (
            (args.where.userId === undefined || request.userId === args.where.userId) &&
            (args.where.status === undefined || request.status === args.where.status)
          );
        });
        const sorted = matches.sort((a, b) =>
          args.orderBy?.createdAt === "desc"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return sorted[0] ?? null;
      },
    ),
    findUnique: jest.fn(async (args: { where: { id: string } }) => {
      return this.recoveryRequests.get(args.where.id) ?? null;
    }),
    findMany: jest.fn(
      async (args: { where: { status?: KeyRecoveryStatus } }) => {
        return [...this.recoveryRequests.values()]
          .filter((request) =>
            args.where.status === undefined ? true : request.status === args.where.status,
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((request) => ({
            ...request,
            user: this.users.get(request.userId)!,
            oldKey: this.deviceKeys.get(request.oldKeyId)!,
          }));
      },
    ),
    create: jest.fn(
      async (args: {
        data: {
          userId: string;
          oldKeyId: string;
          requestedNewPublicKey: string;
          riskType: KeyRecoveryRiskType;
          reason: KeyRecoveryReason;
          userNotes?: string;
          approximateBalanceKobo?: bigint;
          lastMerchantText?: string;
          lastTopupAmountKobo?: bigint;
          createdAt?: Date;
        };
      }) => {
        const createdAt = args.data.createdAt ?? new Date(NOW);
        const request: RecoveryRequestRecord = {
          id: `recovery-${++this.requestCounter}`,
          userId: args.data.userId,
          oldKeyId: args.data.oldKeyId,
          requestedNewPublicKey: args.data.requestedNewPublicKey,
          status: KeyRecoveryStatus.PENDING,
          riskType: args.data.riskType,
          reason: args.data.reason,
          userNotes: args.data.userNotes ?? null,
          approximateBalanceKobo: args.data.approximateBalanceKobo ?? null,
          lastMerchantText: args.data.lastMerchantText ?? null,
          lastTopupAmountKobo: args.data.lastTopupAmountKobo ?? null,
          reviewedByUserId: null,
          reviewedAt: null,
          decisionNotes: null,
          createdAt,
          updatedAt: createdAt,
        };
        this.recoveryRequests.set(request.id, request);
        return request;
      },
    ),
    update: jest.fn(
      async (args: { where: { id: string }; data: Partial<RecoveryRequestRecord> }) => {
        const request = this.recoveryRequests.get(args.where.id);
        if (!request) {
          throw new Error("recovery request missing");
        }
        const updated = { ...request, ...args.data, updatedAt: new Date(NOW) };
        this.recoveryRequests.set(request.id, updated);
        return updated;
      },
    ),
  };

  readonly recoveryBalanceHold = {
    create: jest.fn(
      async (args: {
        data: {
          userId: string;
          recoveryRequestId: string;
          oldKeyId: string;
          status: RecoveryBalanceHoldStatus;
          heldAmountKobo: bigint;
          consumedAmountKobo: bigint;
          holdUntil: Date;
        };
      }) => {
        const hold: RecoveryBalanceHoldRecord = {
          id: `hold-${++this.holdCounter}`,
          userId: args.data.userId,
          recoveryRequestId: args.data.recoveryRequestId,
          oldKeyId: args.data.oldKeyId,
          status: args.data.status,
          heldAmountKobo: args.data.heldAmountKobo,
          consumedAmountKobo: args.data.consumedAmountKobo,
          holdUntil: args.data.holdUntil,
          createdAt: new Date(NOW),
          updatedAt: new Date(NOW),
        };
        this.recoveryBalanceHolds.set(hold.id, hold);
        return hold;
      },
    ),
  };

  readonly $transaction = jest.fn(
    async <T>(callback: (tx: PrismaMock) => Promise<T>) => callback(this),
  );

  addUser(overrides: Partial<UserRecord> = {}) {
    const id = overrides.id ?? `user-${this.users.size + 1}`;
    const user: UserRecord = {
      id,
      email: `${id}@stu.cu.edu.ng`,
      role: Role.STUDENT,
      status: Status.ACTIVE,
      publicKey: null,
      verifiedBalanceKobo: 0n,
      ...overrides,
    };
    this.users.set(user.id, user);
    return user;
  }

  addDeviceKey(overrides: Partial<DeviceKeyRecord> = {}) {
    const id = overrides.id ?? `key-${this.keyCounter + 1}`;
    this.syncKeyCounter(id);
    const key: DeviceKeyRecord = {
      id,
      userId: "user-1",
      publicKey: publicKey(this.keyCounter + 1),
      status: DeviceKeyStatus.ACTIVE,
      validFrom: new Date(NOW),
      retiredAt: null,
      verifyUntil: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      ...overrides,
    };
    this.deviceKeys.set(key.id, key);
    return key;
  }

  addRecoveryRequest(overrides: Partial<RecoveryRequestRecord> = {}) {
    const id = overrides.id ?? `recovery-${++this.requestCounter}`;
    const request: RecoveryRequestRecord = {
      id,
      userId: "user-1",
      oldKeyId: "key-1",
      requestedNewPublicKey: publicKey(999),
      status: KeyRecoveryStatus.PENDING,
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.LOST_PHONE,
      userNotes: null,
      approximateBalanceKobo: null,
      lastMerchantText: null,
      lastTopupAmountKobo: null,
      reviewedByUserId: null,
      reviewedAt: null,
      decisionNotes: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      ...overrides,
    };
    this.recoveryRequests.set(id, request);
    return request;
  }
}

describe("RecoveryService", () => {
  let prisma: PrismaMock;
  let recoveryEmailService: jest.Mocked<RecoveryEmailService>;
  let service: RecoveryService;
  let user: UserRecord;
  let activeKey: DeviceKeyRecord;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = new PrismaMock();
    recoveryEmailService = {
      sendAdminNewRecoveryRequestNotification: jest.fn().mockResolvedValue(undefined),
      sendUserRecoveryRequestReceived: jest.fn().mockResolvedValue(undefined),
      sendUserRecoveryApproved: jest.fn().mockResolvedValue(undefined),
      sendUserRecoveryRejected: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RecoveryEmailService>;
    service = new RecoveryService(
      prisma as unknown as PrismaService,
      recoveryEmailService,
    );
    user = prisma.addUser({
      id: "user-1",
      publicKey: publicKey(1),
      verifiedBalanceKobo: 50_000n,
    });
    activeKey = prisma.addDeviceKey({
      id: "key-1",
      userId: user.id,
      publicKey: publicKey(1),
      status: DeviceKeyStatus.ACTIVE,
    });
    prisma.addUser({ id: "admin-1", role: Role.ADMIN });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates a NEW_PHONE recovery request and emails support plus the user", async () => {
    const result = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(2),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.NEW_PHONE,
      userNotes: "I got a new phone yesterday",
    });

    expect(result.status).toBe(KeyRecoveryStatus.PENDING);
    expect(result.reason).toBe(KeyRecoveryReason.NEW_PHONE);
    expect(recoveryEmailService.sendAdminNewRecoveryRequestNotification).toHaveBeenCalledTimes(1);
    expect(recoveryEmailService.sendUserRecoveryRequestReceived).toHaveBeenCalledTimes(1);
  });

  it("keeps the old key ACTIVE for normal recovery requests", async () => {
    await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(3),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.APP_UNINSTALLED,
    });

    expect(prisma.deviceKeys.get(activeKey.id)?.status).toBe(DeviceKeyStatus.ACTIVE);
  });

  it("moves the old key to VERIFY_ONLY immediately for stolen-phone reports", async () => {
    const result = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(4),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.STOLEN_PHONE,
    });

    const oldKey = prisma.deviceKeys.get(activeKey.id);
    expect(result.status).toBe(KeyRecoveryStatus.PENDING);
    expect(oldKey?.status).toBe(DeviceKeyStatus.VERIFY_ONLY);
    expect(oldKey?.retiredAt?.toISOString()).toBe(NOW.toISOString());
    expect(oldKey?.verifyUntil?.toISOString()).toBe(
      new Date(NOW.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS).toISOString(),
    );
  });

  it("approves normal recovery by retiring the old ACTIVE key for 48 hours and activating the new key", async () => {
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(5),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.NEW_PHONE,
    });

    const result = await service.approveRecoveryRequest(request.id, "admin-1", {});

    const oldKey = prisma.deviceKeys.get(activeKey.id);
    const newKey = [...prisma.deviceKeys.values()].find(
      (key) => key.publicKey === publicKey(5),
    );
    expect(result.status).toBe(KeyRecoveryStatus.APPROVED);
    expect(oldKey?.status).toBe(DeviceKeyStatus.VERIFY_ONLY);
    expect(oldKey?.retiredAt?.toISOString()).toBe(NOW.toISOString());
    expect(oldKey?.verifyUntil?.toISOString()).toBe(
      new Date(NOW.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS).toISOString(),
    );
    expect(newKey?.status).toBe(DeviceKeyStatus.ACTIVE);
    expect(prisma.users.get(user.id)?.publicKey).toBe(publicKey(5));
    const createdHold = [...prisma.recoveryBalanceHolds.values()][0];
    expect(createdHold).toMatchObject({
      userId: user.id,
      recoveryRequestId: request.id,
      oldKeyId: activeKey.id,
      status: RecoveryBalanceHoldStatus.ACTIVE,
      heldAmountKobo: user.verifiedBalanceKobo,
      consumedAmountKobo: 0n,
    });
    expect(createdHold?.holdUntil.toISOString()).toBe(
      new Date(NOW.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS).toISOString(),
    );
    expect(recoveryEmailService.sendUserRecoveryApproved).toHaveBeenCalledTimes(1);
  });

  it("does not create a recovery balance hold when the approval balance is zero", async () => {
    prisma.users.set(user.id, { ...user, verifiedBalanceKobo: 0n });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(12),
    });

    await service.approveRecoveryRequest(request.id, "admin-1", {});

    expect(prisma.recoveryBalanceHold.create).not.toHaveBeenCalled();
    expect(prisma.recoveryBalanceHolds.size).toBe(0);
  });

  it("preserves the stolen-phone report time when approval happens later", async () => {
    const reportTime = new Date("2026-05-29T08:00:00.000Z");
    prisma.deviceKeys.set(activeKey.id, {
      ...activeKey,
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: reportTime,
      verifyUntil: new Date(reportTime.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS),
    });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(6),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.STOLEN_PHONE,
      createdAt: reportTime,
      updatedAt: reportTime,
    });

    await service.approveRecoveryRequest(request.id, "admin-1", {});

    const oldKey = prisma.deviceKeys.get(activeKey.id);
    expect(oldKey?.status).toBe(DeviceKeyStatus.VERIFY_ONLY);
    expect(oldKey?.retiredAt?.toISOString()).toBe(reportTime.toISOString());
    expect(oldKey?.verifyUntil?.toISOString()).toBe(
      new Date(reportTime.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS).toISOString(),
    );
  });

  it("rejects recovery and leaves a stolen old key in VERIFY_ONLY for manual follow-up", async () => {
    const reportTime = new Date("2026-05-29T08:00:00.000Z");
    prisma.deviceKeys.set(activeKey.id, {
      ...activeKey,
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: reportTime,
      verifyUntil: new Date(reportTime.getTime() + RECOVERY_VERIFY_ONLY_WINDOW_MS),
    });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(7),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.STOLEN_PHONE,
    });

    const result = await service.rejectRecoveryRequest(request.id, "admin-1", {
      decisionNotes: "Need more verification",
    });

    expect(result.status).toBe(KeyRecoveryStatus.REJECTED);
    expect(prisma.deviceKeys.get(activeKey.id)?.status).toBe(DeviceKeyStatus.VERIFY_ONLY);
    expect(recoveryEmailService.sendUserRecoveryRejected).toHaveBeenCalledTimes(1);
  });

  it("does not fail request creation when recovery email delivery throws", async () => {
    recoveryEmailService.sendAdminNewRecoveryRequestNotification.mockRejectedValueOnce(
      new Error("mail_down"),
    );

    await expect(
      service.createRecoveryRequest(user.id, {
        requestedNewPublicKey: publicKey(8),
        riskType: KeyRecoveryRiskType.LOST_DEVICE,
        reason: KeyRecoveryReason.NEW_PHONE,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: KeyRecoveryStatus.PENDING,
      }),
    );
  });

  it("does not fail approval when recovery email delivery throws", async () => {
    recoveryEmailService.sendUserRecoveryApproved.mockRejectedValueOnce(
      new Error("mail_down"),
    );
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(9),
    });

    await expect(
      service.approveRecoveryRequest(request.id, "admin-1", {}),
    ).resolves.toEqual(
      expect.objectContaining({
        status: KeyRecoveryStatus.APPROVED,
      }),
    );
  });

  it("prevents non-admin users from approving or rejecting recovery requests", async () => {
    prisma.addUser({ id: "student-admin", role: Role.STUDENT });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(10),
    });

    await expect(
      service.approveRecoveryRequest(request.id, "student-admin", {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.rejectRecoveryRequest(request.id, "student-admin", {
        decisionNotes: "no",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("fails normal approval if the old key is no longer ACTIVE", async () => {
    prisma.deviceKeys.set(activeKey.id, {
      ...activeKey,
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: new Date(NOW),
    });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(11),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.NEW_PHONE,
    });

    await expect(
      service.approveRecoveryRequest(request.id, "admin-1", {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
