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
import { RecoveryService } from "./recovery.service";

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

type WhereArgs = {
  where: {
    id?: string;
    userId?: string;
    publicKey?: string;
    status?: DeviceKeyStatus | KeyRecoveryStatus;
  };
};

type CreateRecoveryArgs = {
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
  };
};

type UpdateRecoveryArgs = {
  where: { id: string };
  data: Partial<RecoveryRequestRecord>;
};

type CreateDeviceKeyArgs = {
  data: {
    userId: string;
    publicKey: string;
    status: DeviceKeyStatus;
    validFrom?: Date;
  };
};

type UpdateDeviceKeyArgs = {
  where: { id: string };
  data: Partial<DeviceKeyRecord>;
};

type UpdateUserArgs = {
  where: { id: string };
  data: Partial<UserRecord>;
};

const now = new Date("2026-05-21T03:10:00.000Z");

const publicKey = (n: number) => `ed25519:${n.toString(16).padStart(64, "0")}`;

class PrismaMock {
  readonly users = new Map<string, UserRecord>();
  readonly deviceKeys = new Map<string, DeviceKeyRecord>();
  readonly recoveryRequests = new Map<string, RecoveryRequestRecord>();
  private keyCounter = 0;
  private requestCounter = 0;

  readonly user = {
    findUnique: jest.fn(async (args: WhereArgs) => {
      const id = args.where.id;
      return id ? this.users.get(id) ?? null : null;
    }),
    update: jest.fn(async (args: UpdateUserArgs) => {
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
    findFirst: jest.fn(async (args: WhereArgs) => {
      return (
        [...this.deviceKeys.values()].find((key) => {
          return (
            (args.where.userId === undefined || key.userId === args.where.userId) &&
            (args.where.status === undefined || key.status === args.where.status)
          );
        }) ?? null
      );
    }),
    findUnique: jest.fn(async (args: WhereArgs) => {
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
    }),
    update: jest.fn(async (args: UpdateDeviceKeyArgs) => {
      const key = this.deviceKeys.get(args.where.id);
      if (!key) {
        throw new Error("device key missing");
      }

      const updated = { ...key, ...args.data, updatedAt: now };
      this.deviceKeys.set(key.id, updated);
      return updated;
    }),
    create: jest.fn(async (args: CreateDeviceKeyArgs) => {
      const key: DeviceKeyRecord = {
        id: `key-${++this.keyCounter}`,
        userId: args.data.userId,
        publicKey: args.data.publicKey,
        status: args.data.status,
        validFrom: args.data.validFrom ?? now,
        retiredAt: null,
        verifyUntil: null,
        createdAt: now,
        updatedAt: now,
      };
      this.deviceKeys.set(key.id, key);
      return key;
    }),
  };

  readonly keyRecoveryRequest = {
    findFirst: jest.fn(async (args: WhereArgs & { orderBy?: Record<string, string> }) => {
      const matches = [...this.recoveryRequests.values()].filter((request) => {
        return (
          (args.where.userId === undefined || request.userId === args.where.userId) &&
          (args.where.status === undefined || request.status === args.where.status)
        );
      });

      const sorted = this.sortRequests(matches, args.orderBy);
      return sorted[0] ?? null;
    }),
    findUnique: jest.fn(async (args: WhereArgs) => {
      const id = args.where.id;
      return id ? this.recoveryRequests.get(id) ?? null : null;
    }),
    findMany: jest.fn(async (args: WhereArgs & { orderBy?: Record<string, string> }) => {
      const matches = [...this.recoveryRequests.values()].filter((request) => {
        return args.where.status === undefined || request.status === args.where.status;
      });

      return this.sortRequests(matches, args.orderBy).map((request) => ({
        ...request,
        user: this.users.get(request.userId),
        oldKey: this.deviceKeys.get(request.oldKeyId),
      }));
    }),
    create: jest.fn(async (args: CreateRecoveryArgs) => {
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
        createdAt: now,
        updatedAt: now,
      };

      this.recoveryRequests.set(request.id, request);
      return request;
    }),
    update: jest.fn(async (args: UpdateRecoveryArgs) => {
      const request = this.recoveryRequests.get(args.where.id);
      if (!request) {
        throw new Error("recovery request missing");
      }

      const updated = { ...request, ...args.data, updatedAt: now };
      this.recoveryRequests.set(request.id, updated);
      return updated;
    }),
  };

  readonly $transaction = jest.fn(async <T>(callback: (tx: PrismaMock) => Promise<T>) => {
    return callback(this);
  });

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
    const generatedId = `key-${++this.keyCounter}`;
    const id = overrides.id ?? generatedId;
    const key: DeviceKeyRecord = {
      id,
      userId: "user-1",
      publicKey: publicKey(this.keyCounter),
      status: DeviceKeyStatus.ACTIVE,
      validFrom: now,
      retiredAt: null,
      verifyUntil: null,
      createdAt: now,
      updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.recoveryRequests.set(request.id, request);
    return request;
  }

  private sortRequests(
    requests: RecoveryRequestRecord[],
    orderBy?: Record<string, string>,
  ) {
    const direction = orderBy?.createdAt;
    if (!direction) {
      return requests;
    }

    return [...requests].sort((a, b) => {
      const delta = a.createdAt.getTime() - b.createdAt.getTime();
      return direction === "desc" ? -delta : delta;
    });
  }
}

describe("RecoveryService", () => {
  let prisma: PrismaMock;
  let service: RecoveryService;
  let user: UserRecord;
  let activeKey: DeviceKeyRecord;

  beforeEach(() => {
    prisma = new PrismaMock();
    service = new RecoveryService(prisma as unknown as PrismaService);
    user = prisma.addUser({ id: "user-1", publicKey: publicKey(1) });
    activeKey = prisma.addDeviceKey({
      id: "key-1",
      userId: user.id,
      publicKey: publicKey(1),
      status: DeviceKeyStatus.ACTIVE,
    });
    prisma.addUser({ id: "admin-1", role: Role.ADMIN });
  });

  it("creates a LOST_DEVICE recovery request", async () => {
    const result = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(2),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.LOST_PHONE,
      approximateBalanceKobo: 1200,
      lastMerchantText: "Cafeteria",
    });

    expect(result.status).toBe(KeyRecoveryStatus.PENDING);
    expect(result.riskType).toBe(KeyRecoveryRiskType.LOST_DEVICE);
    expect(result.approximateBalanceKobo).toBe("1200");
  });

  it("creates a COMPROMISED_DEVICE recovery request", async () => {
    const result = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(3),
      riskType: KeyRecoveryRiskType.COMPROMISED_DEVICE,
      reason: KeyRecoveryReason.STOLEN_PHONE,
    });

    expect(result.status).toBe(KeyRecoveryStatus.PENDING);
    expect(result.riskType).toBe(KeyRecoveryRiskType.COMPROMISED_DEVICE);
  });

  it("does not change the ACTIVE key when creating a request", async () => {
    await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(4),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.APP_UNINSTALLED,
    });

    expect(prisma.deviceKeys.get(activeKey.id)?.status).toBe(DeviceKeyStatus.ACTIVE);
    expect([...prisma.deviceKeys.values()].filter((key) => key.status === DeviceKeyStatus.ACTIVE)).toHaveLength(1);
  });

  it("does not update User.publicKey when creating a request", async () => {
    await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(5),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.DAMAGED_PHONE,
    });

    expect(prisma.users.get(user.id)?.publicKey).toBe(activeKey.publicKey);
  });

  it("returns an existing pending request instead of creating a duplicate", async () => {
    const first = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(6),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
      reason: KeyRecoveryReason.FACTORY_RESET,
    });
    const second = await service.createRecoveryRequest(user.id, {
      requestedNewPublicKey: publicKey(7),
      riskType: KeyRecoveryRiskType.COMPROMISED_DEVICE,
      reason: KeyRecoveryReason.STOLEN_PHONE,
    });

    expect(second.id).toBe(first.id);
    expect(prisma.recoveryRequests.size).toBe(1);
  });

  it("rejects a requested new public key already used by another account", async () => {
    const otherUser = prisma.addUser({ id: "user-2", publicKey: publicKey(8) });
    prisma.addDeviceKey({
      id: "key-2",
      userId: otherUser.id,
      publicKey: publicKey(8),
      status: DeviceKeyStatus.ACTIVE,
    });

    await expect(
      service.createRecoveryRequest(user.id, {
        requestedNewPublicKey: publicKey(8),
        riskType: KeyRecoveryRiskType.LOST_DEVICE,
        reason: KeyRecoveryReason.LOST_PHONE,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("returns the latest recovery status for a user", async () => {
    prisma.addRecoveryRequest({
      id: "old-request",
      userId: user.id,
      oldKeyId: activeKey.id,
      status: KeyRecoveryStatus.REJECTED,
      createdAt: new Date("2026-05-21T03:00:00.000Z"),
    });
    prisma.addRecoveryRequest({
      id: "new-request",
      userId: user.id,
      oldKeyId: activeKey.id,
      status: KeyRecoveryStatus.PENDING,
      createdAt: new Date("2026-05-21T03:05:00.000Z"),
    });

    const status = await service.getLatestRecoveryStatus(user.id);

    expect(status?.id).toBe("new-request");
  });

  it("allows a user to cancel their own pending request", async () => {
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
    });

    const result = await service.cancelRecoveryRequest(user.id, request.id);

    expect(result.status).toBe(KeyRecoveryStatus.CANCELLED);
    expect(prisma.recoveryRequests.get(request.id)?.status).toBe(KeyRecoveryStatus.CANCELLED);
  });

  it("prevents a user from cancelling another user's request", async () => {
    const request = prisma.addRecoveryRequest({
      userId: "user-2",
      oldKeyId: activeKey.id,
    });

    await expect(
      service.cancelRecoveryRequest(user.id, request.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists pending recovery requests oldest first for admin review", async () => {
    prisma.addRecoveryRequest({
      id: "newer",
      userId: user.id,
      oldKeyId: activeKey.id,
      createdAt: new Date("2026-05-21T03:05:00.000Z"),
    });
    prisma.addRecoveryRequest({
      id: "older",
      userId: user.id,
      oldKeyId: activeKey.id,
      createdAt: new Date("2026-05-21T03:00:00.000Z"),
    });

    const pending = await service.listPendingRecoveryRequests();

    expect(pending.map((request) => request.id)).toEqual(["older", "newer"]);
    const firstPending = pending[0];
    expect(firstPending).toBeDefined();
    if (!firstPending) {
      throw new Error("expected first pending recovery request");
    }
    expect(firstPending.user.id).toBe(user.id);
    expect(firstPending.oldKey.id).toBe(activeKey.id);
  });

  it("approves LOST_DEVICE recovery by retiring the old key as VERIFY_ONLY and activating the new key", async () => {
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(9),
      riskType: KeyRecoveryRiskType.LOST_DEVICE,
    });

    const result = await service.approveRecoveryRequest(request.id, "admin-1", {});

    const oldKey = prisma.deviceKeys.get(activeKey.id);
    const newKey = [...prisma.deviceKeys.values()].find(
      (key) => key.publicKey === publicKey(9),
    );
    expect(result.status).toBe(KeyRecoveryStatus.APPROVED);
    expect(oldKey?.status).toBe(DeviceKeyStatus.VERIFY_ONLY);
    expect(oldKey?.retiredAt).toBeInstanceOf(Date);
    expect(oldKey?.verifyUntil).toBeInstanceOf(Date);
    expect(newKey?.status).toBe(DeviceKeyStatus.ACTIVE);
    expect(prisma.users.get(user.id)?.publicKey).toBe(publicKey(9));
    expect([...prisma.deviceKeys.values()].filter((key) => key.userId === user.id && key.status === DeviceKeyStatus.ACTIVE)).toHaveLength(1);
  });

  it("approves COMPROMISED_DEVICE recovery by revoking the old key and activating the new key", async () => {
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(10),
      riskType: KeyRecoveryRiskType.COMPROMISED_DEVICE,
    });

    await service.approveRecoveryRequest(request.id, "admin-1", {
      decisionNotes: "Stolen while unlocked",
    });

    const oldKey = prisma.deviceKeys.get(activeKey.id);
    const newKey = [...prisma.deviceKeys.values()].find(
      (key) => key.publicKey === publicKey(10),
    );
    expect(oldKey?.status).toBe(DeviceKeyStatus.REVOKED);
    expect(oldKey?.retiredAt).toBeInstanceOf(Date);
    expect(oldKey?.verifyUntil).toBeNull();
    expect(newKey?.status).toBe(DeviceKeyStatus.ACTIVE);
    expect(prisma.users.get(user.id)?.publicKey).toBe(publicKey(10));
  });

  it("rejects a recovery request without changing keys", async () => {
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(11),
    });

    const result = await service.rejectRecoveryRequest(request.id, "admin-1", {
      decisionNotes: "Could not verify account details",
    });

    expect(result.status).toBe(KeyRecoveryStatus.REJECTED);
    expect(prisma.deviceKeys.get(activeKey.id)?.status).toBe(DeviceKeyStatus.ACTIVE);
    expect([...prisma.deviceKeys.values()].some((key) => key.publicKey === publicKey(11))).toBe(false);
    expect(prisma.users.get(user.id)?.publicKey).toBe(activeKey.publicKey);
  });

  it("prevents non-admin users from approving or rejecting requests", async () => {
    prisma.addUser({ id: "student-admin", role: Role.STUDENT });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(12),
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

  it("fails approval if the old key is no longer ACTIVE", async () => {
    prisma.deviceKeys.set(activeKey.id, {
      ...activeKey,
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: now,
    });
    const request = prisma.addRecoveryRequest({
      userId: user.id,
      oldKeyId: activeKey.id,
      requestedNewPublicKey: publicKey(13),
    });

    await expect(
      service.approveRecoveryRequest(request.id, "admin-1", {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
