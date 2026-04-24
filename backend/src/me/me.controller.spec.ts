import { Test } from "@nestjs/testing";
import { ExecutionContext } from "@nestjs/common";
import { MeController } from "./me.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotFoundException, BadRequestException } from "@nestjs/common";

describe("MeController", () => {
  let controller: MeController;
  let mockPrisma: {
    user: { findUnique: jest.Mock };
    ledgerEntry: { findMany: jest.Mock };
  };

  const baseUser = {
    id: "u_test00000000001",
    email: "alice@stu.cu.edu.ng",
    phone: null,
    role: "STUDENT",
    status: "ACTIVE",
    verifiedBalanceKobo: 50000n,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const mockReq = (userId: string) => ({
    user: { sub: userId, email: "alice@stu.cu.edu.ng", role: "STUDENT" },
  });

  const mockJwtGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { sub: "u_test00000000001", email: "alice@stu.cu.edu.ng", role: "STUDENT" };
      return true;
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
      ledgerEntry: { findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      controllers: [MeController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile();

    controller = module.get(MeController);
  });

  describe("GET /me", () => {
    it("returns user profile with BigInt balance as string", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      const result = await controller.getMe(mockReq(baseUser.id) as any);

      expect(result).toEqual({
        id: baseUser.id,
        email: baseUser.email,
        phone: null,
        role: "STUDENT",
        status: "ACTIVE",
        verifiedBalanceKobo: "50000",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("throws NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        controller.getMe(mockReq("u_missing") as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("does not expose publicKey in response", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      const result = await controller.getMe(mockReq(baseUser.id) as any);

      expect(result).not.toHaveProperty("publicKey");
    });

    it("selects only safe fields from Prisma", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await controller.getMe(mockReq(baseUser.id) as any);

      const call = mockPrisma.user.findUnique.mock.calls[0][0];
      expect(call.select).not.toHaveProperty("publicKey");
      expect(call.select).not.toHaveProperty("sequenceNumber");
    });
  });

  describe("GET /me/ledger", () => {
    const baseEntry = {
      id: "l_1",
      transactionId: "tx_abc",
      type: "DEBIT",
      amountKobo: 1000n,
      balanceAfterKobo: 49000n,
      description: "Payment to merchant",
      createdAt: new Date("2026-04-01T10:00:00Z"),
    };

    it("returns entries with BigInts as strings and ISO dates", async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([baseEntry]);

      const result = await controller.getLedger(
        mockReq("u_test") as any,
        undefined,
        undefined,
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        id: "l_1",
        transactionId: "tx_abc",
        type: "DEBIT",
        amountKobo: "1000",
        balanceAfterKobo: "49000",
        description: "Payment to merchant",
        createdAt: "2026-04-01T10:00:00.000Z",
      });
      expect(result.nextCursor).toBeNull();
    });

    it("defaults limit to 20 when not provided", async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([]);

      await controller.getLedger(mockReq("u_test") as any, undefined, undefined);

      const call = mockPrisma.ledgerEntry.findMany.mock.calls[0][0];
      expect(call.take).toBe(21); // limit + 1 for has-more detection
    });

    it("rejects limit over 100", async () => {
      await expect(
        controller.getLedger(mockReq("u_test") as any, undefined, "200"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects limit under 1", async () => {
      await expect(
        controller.getLedger(mockReq("u_test") as any, undefined, "0"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects invalid cursor", async () => {
      await expect(
        controller.getLedger(mockReq("u_test") as any, "not-a-date", undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns nextCursor when more entries exist", async () => {
      const entries = Array.from({ length: 21 }, (_, i) => ({
        ...baseEntry,
        id: `l_${i}`,
        createdAt: new Date(2026, 3, 21 - i),
      }));
      mockPrisma.ledgerEntry.findMany.mockResolvedValue(entries);

      const result = await controller.getLedger(
        mockReq("u_test") as any,
        undefined,
        "20",
      );

      expect(result.entries).toHaveLength(20);
      expect(result.nextCursor).toBe(entries[19]!.createdAt.toISOString());
    });

    it("scopes query to authenticated user only", async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([]);

      await controller.getLedger(mockReq("u_alice") as any, undefined, undefined);

      const call = mockPrisma.ledgerEntry.findMany.mock.calls[0][0];
      expect(call.where.userId).toBe("u_alice");
    });
  });
});