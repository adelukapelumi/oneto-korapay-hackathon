import {
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CashoutStatus, Role, Status } from "@prisma/client";
import { AdminService } from "./admin.service";

describe("AdminService", () => {
  let service: AdminService;

  const prisma = {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
    },
    cashout: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    merchantProfile: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(prisma);
  });

  it("getPendingMerchants returns only pending merchant applications", async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: "u_m1",
        email: "m1@getoneto.com",
        status: Status.PENDING_VERIFICATION,
        createdAt: new Date("2026-05-14T00:00:00.000Z"),
        merchantProfile: {
          businessName: "Shop One",
          businessAddress: "CU Plaza",
          verifiedAt: null,
          cashoutBankName: "Bank",
          cashoutBankCode: "001",
          cashoutAccountNumber: "0123456789",
          cashoutAccountName: "Shop One Ltd",
        },
      },
    ]);

    const result = await service.getPendingMerchants();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: Role.MERCHANT,
          status: Status.PENDING_VERIFICATION,
          merchantProfile: { is: { verifiedAt: null } },
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: "u_m1",
      status: Status.PENDING_VERIFICATION,
      businessName: "Shop One",
      verifiedAt: null,
    });
  });

  it("getPendingMerchants excludes ACTIVE merchant even if verifiedAt is null", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    const result = await service.getPendingMerchants();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: Role.MERCHANT,
          status: Status.PENDING_VERIFICATION,
          merchantProfile: { is: { verifiedAt: null } },
        }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("approveMerchant rejects when user does not exist", async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      }),
    );

    await expect(service.approveMerchant("u_missing", "u_admin")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("approveMerchant rejects when user role is not MERCHANT", async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u_student",
            role: Role.STUDENT,
            merchantProfile: null,
          }),
        },
      }),
    );

    await expect(service.approveMerchant("u_student", "u_admin")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("approveMerchant sets ACTIVE and verifiedAt in one transaction callback", async () => {
    const txUserUpdate = jest.fn().mockResolvedValue({});
    const txProfileUpdate = jest.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u_merchant",
            role: Role.MERCHANT,
            status: Status.PENDING_VERIFICATION,
            merchantProfile: {
              verifiedAt: null,
            },
          }),
          update: txUserUpdate,
        },
        merchantProfile: {
          update: txProfileUpdate,
        },
      }),
    );

    const result = await service.approveMerchant("u_merchant", "u_admin");

    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: "u_merchant" },
      data: { status: Status.ACTIVE },
    });
    expect(txProfileUpdate).toHaveBeenCalledWith({
      where: { userId: "u_merchant" },
      data: expect.objectContaining({ verifiedAt: expect.any(Date) }),
    });
    expect(result.status).toBe(Status.ACTIVE);
    expect(result.verifiedAt).toEqual(expect.any(String));
  });

  it("approveMerchant rejects already approved merchants (non-idempotent)", async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u_merchant",
            role: Role.MERCHANT,
            status: Status.PENDING_VERIFICATION,
            merchantProfile: {
              verifiedAt: new Date("2026-05-01T00:00:00.000Z"),
            },
          }),
        },
      }),
    );

    await expect(service.approveMerchant("u_merchant", "u_admin")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("approveMerchant rejects FROZEN merchant even if verifiedAt is null", async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u_merchant",
            role: Role.MERCHANT,
            status: Status.FROZEN,
            merchantProfile: {
              verifiedAt: null,
            },
          }),
        },
      }),
    );

    await expect(service.approveMerchant("u_merchant", "u_admin")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("approveMerchant rejects FLAGGED merchant even if verifiedAt is null", async () => {
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u_merchant",
            role: Role.MERCHANT,
            status: Status.FLAGGED,
            merchantProfile: {
              verifiedAt: null,
            },
          }),
        },
      }),
    );

    await expect(service.approveMerchant("u_merchant", "u_admin")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("getPendingCashouts filters to PENDING status", async () => {
    prisma.cashout.findMany.mockResolvedValue([
      {
        id: "c_1",
        merchantUserId: "u_m1",
        amountKobo: 5000n,
        requestedAt: new Date("2026-05-14T00:00:00.000Z"),
        status: CashoutStatus.PENDING,
        cashoutBankName: "Bank",
        cashoutBankCode: "001",
        cashoutAccountNumber: "0123456789",
        cashoutAccountName: "Shop One Ltd",
        merchant: { merchantProfile: { businessName: "Shop One" } },
      },
    ]);

    const result = await service.getPendingCashouts();

    expect(prisma.cashout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: CashoutStatus.PENDING },
      }),
    );
    expect(result[0]).toMatchObject({
      id: "c_1",
      amountKobo: "5000",
      status: CashoutStatus.PENDING,
    });
  });

  it("getReconciliationReport returns invariant pass when sum is zero", async () => {
    prisma.user.aggregate.mockResolvedValue({
      _sum: { verifiedBalanceKobo: 0n },
    });
    prisma.user.findUnique.mockResolvedValue({
      verifiedBalanceKobo: -12000n,
    });

    const result = await service.getReconciliationReport();

    expect(result.sumAllVerifiedBalancesKobo).toBe("0");
    expect(result.operatingBalanceKobo).toBe("-12000");
    expect(result.operatingAccountPresent).toBe(true);
    expect(result.invariantPasses).toBe(true);
  });

  it("getReconciliationReport returns invariant fail and missing operating account explicitly", async () => {
    prisma.user.aggregate.mockResolvedValue({
      _sum: { verifiedBalanceKobo: 200n },
    });
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.getReconciliationReport();

    expect(result.sumAllVerifiedBalancesKobo).toBe("200");
    expect(result.operatingBalanceKobo).toBeNull();
    expect(result.operatingAccountPresent).toBe(false);
    expect(result.invariantPasses).toBe(false);
  });
});
