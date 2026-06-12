import { NotFoundException } from "@nestjs/common";
import { RecoveryBalanceHoldStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RecoveryBalanceService } from "./recovery-balance.service";

describe("RecoveryBalanceService", () => {
  const now = new Date("2026-06-12T10:00:00.000Z");
  let service: RecoveryBalanceService;
  let prisma: {
    user: { findUnique: jest.Mock };
    recoveryBalanceHold: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      recoveryBalanceHold: { findMany: jest.fn() },
    };
    service = new RecoveryBalanceService(prisma as unknown as PrismaService);
  });

  it("keeps fresh topups available while an old-device hold remains active", async () => {
    prisma.user.findUnique.mockResolvedValue({ verifiedBalanceKobo: 13_000n });
    prisma.recoveryBalanceHold.findMany.mockResolvedValue([
      {
        id: "hold-1",
        userId: "user-1",
        oldKeyId: "key-1",
        heldAmountKobo: 10_000n,
        consumedAmountKobo: 2_000n,
        holdUntil: new Date("2026-06-14T10:00:00.000Z"),
      },
    ]);

    await expect(
      service.getBalanceSnapshot("user-1", prisma as unknown as PrismaService, now),
    ).resolves.toEqual({
      verifiedBalanceKobo: 13_000n,
      activeRecoveryHeldBalanceKobo: 8_000n,
      availableBalanceKobo: 5_000n,
      recoveryHoldUntil: new Date("2026-06-14T10:00:00.000Z"),
    });
  });

  it("ignores fully consumed active holds", async () => {
    prisma.user.findUnique.mockResolvedValue({ verifiedBalanceKobo: 13_000n });
    prisma.recoveryBalanceHold.findMany.mockResolvedValue([
      {
        id: "hold-1",
        userId: "user-1",
        oldKeyId: "key-1",
        heldAmountKobo: 10_000n,
        consumedAmountKobo: 10_000n,
        holdUntil: new Date("2026-06-14T10:00:00.000Z"),
      },
    ]);

    const snapshot = await service.getBalanceSnapshot(
      "user-1",
      prisma as unknown as PrismaService,
      now,
    );

    expect(snapshot.activeRecoveryHeldBalanceKobo).toBe(0n);
    expect(snapshot.availableBalanceKobo).toBe(13_000n);
    expect(snapshot.recoveryHoldUntil).toBeNull();
  });

  it("returns the active hold for a specific old key", async () => {
    prisma.recoveryBalanceHold.findMany.mockResolvedValue([
      {
        id: "hold-1",
        userId: "user-1",
        oldKeyId: "key-1",
        heldAmountKobo: 5_000n,
        consumedAmountKobo: 1_500n,
        holdUntil: new Date("2026-06-14T10:00:00.000Z"),
        status: RecoveryBalanceHoldStatus.ACTIVE,
      },
    ]);

    const hold = await service.getActiveHoldForOldKey(
      "user-1",
      "key-1",
      prisma as unknown as PrismaService,
      now,
    );

    expect(hold?.id).toBe("hold-1");
    expect(service.getRemainingHoldAmount(hold!)).toBe(3_500n);
  });

  it("throws when the user does not exist", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.getBalanceSnapshot("missing", prisma as unknown as PrismaService, now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
