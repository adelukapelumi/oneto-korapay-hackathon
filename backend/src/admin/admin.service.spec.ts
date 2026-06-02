import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CashoutStatus, KorapayPayoutFeeBearer, Role, Status } from "@prisma/client";
import { AdminService } from "./admin.service";
import { generateOnetoUserId } from "../common/user-id";
import { KorapayGatewayError } from "../topup/korapay.service";

jest.mock("../common/user-id", () => ({
  generateOnetoUserId: jest.fn(),
}));

describe("AdminService", () => {
  let service: AdminService;
  let korapayService: {
    listBanks: jest.Mock;
    resolveBankAccount: jest.Mock;
  };

  let prisma: {
    user: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    cashout: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
    merchantProfile: {
      update: jest.Mock;
    };
    ledgerEntry: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const buildMerchantRecord = (overrides?: Partial<{
    id: string;
    email: string;
    status: Status;
    createdAt: Date;
    updatedAt: Date;
    merchantProfile: {
      businessName: string;
      businessAddress: string | null;
      cashoutBankName: string;
      cashoutBankCode: string;
      cashoutAccountNumber: string;
      cashoutAccountName: string;
      verifiedAt: Date | null;
    } | null;
  }>) => ({
    id: "u_merchant",
    email: "merchant@getoneto.com",
    status: Status.ACTIVE,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    merchantProfile: {
      businessName: "Campus Cafe",
      businessAddress: "CU Plaza",
      cashoutBankName: "Wema Bank",
      cashoutBankCode: "035",
      cashoutAccountNumber: "1234567890",
      cashoutAccountName: "Campus Cafe Ltd",
      verifiedAt: new Date("2026-05-18T00:00:00.000Z"),
    },
    ...overrides,
  });

  beforeEach(() => {
    (generateOnetoUserId as jest.Mock).mockReturnValue("u_bbbbbbbbbbbbbbbb");

    prisma = {
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      cashout: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      merchantProfile: {
        update: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
    };

    korapayService = {
      listBanks: jest.fn(),
      resolveBankAccount: jest.fn(),
    };

    jest.clearAllMocks();
    service = new AdminService(prisma as never, korapayService as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("listMerchants returns all merchant statuses with admin-safe fields", async () => {
    prisma.user.findMany.mockResolvedValue([
      buildMerchantRecord({ id: "u_active", status: Status.ACTIVE }),
      buildMerchantRecord({ id: "u_frozen", status: Status.FROZEN }),
      buildMerchantRecord({ id: "u_flagged", status: Status.FLAGGED }),
      buildMerchantRecord({
        id: "u_pending",
        status: Status.PENDING_VERIFICATION,
        merchantProfile: {
          businessName: "Campus Cafe",
          businessAddress: "CU Plaza",
          cashoutBankName: "Wema Bank",
          cashoutBankCode: "035",
          cashoutAccountNumber: "1234567890",
          cashoutAccountName: "Campus Cafe Ltd",
          verifiedAt: null,
        },
      }),
    ]);

    const result = await service.listMerchants();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: Role.MERCHANT },
      select: expect.any(Object),
      orderBy: [{ createdAt: "desc" }],
    });
    expect(result.map((merchant) => merchant.status)).toEqual([
      Status.ACTIVE,
      Status.FROZEN,
      Status.FLAGGED,
      Status.PENDING_VERIFICATION,
    ]);
    expect(result[0]).toEqual({
      userId: "u_active",
      email: "merchant@getoneto.com",
      status: Status.ACTIVE,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
      businessName: "Campus Cafe",
      businessAddress: "CU Plaza",
      cashoutBankName: "Wema Bank",
      cashoutBankCode: "035",
      cashoutAccountNumber: "1234567890",
      cashoutAccountName: "Campus Cafe Ltd",
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
  });

  it("listBanks returns Korapay bank options with safe fields only", async () => {
    korapayService.listBanks.mockResolvedValue([
      {
        name: "Wema Bank",
        code: "035",
        countryCode: "NG",
        slug: "wema-bank",
      },
    ]);

    await expect(service.listBanks("NG")).resolves.toEqual([
      {
        name: "Wema Bank",
        code: "035",
        countryCode: "NG",
      },
    ]);
    expect(korapayService.listBanks).toHaveBeenCalledWith("NG");
  });

  it("resolveBankAccount sends NG currency and returns normalized account details", async () => {
    korapayService.resolveBankAccount.mockResolvedValue({
      accountName: "Campus Cafe Ltd",
      accountNumber: "1234567890",
      bankCode: "035",
      bankName: "Wema Bank",
    });

    await expect(
      service.resolveBankAccount({
        bankCode: "035",
        accountNumber: "1234567890",
      }),
    ).resolves.toEqual({
      accountName: "Campus Cafe Ltd",
      accountNumber: "1234567890",
      bankCode: "035",
      bankName: "Wema Bank",
    });
    expect(korapayService.resolveBankAccount).toHaveBeenCalledWith({
      bankCode: "035",
      accountNumber: "1234567890",
      currency: "NG",
    });
  });

  it("resolveBankAccount converts Korapay 4xx errors into clear admin input errors", async () => {
    korapayService.resolveBankAccount.mockRejectedValue(
      new KorapayGatewayError({
        message: "invalid account",
        category: "http_error",
        statusCode: 422,
        responseBody: { message: "invalid account" },
      }),
    );

    await expect(
      service.resolveBankAccount({
        bankCode: "035",
        accountNumber: "1234567890",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("createMerchant creates ACTIVE MERCHANT and verified MerchantProfile in one transaction", async () => {
    const createdMerchant = buildMerchantRecord();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(createdMerchant);

    const result = await service.createMerchant(
      {
        email: " Merchant@GetOneto.com ",
        businessName: "Campus Cafe",
        businessAddress: "CU Plaza",
        cashoutBankName: "Wema Bank",
        cashoutBankCode: "035",
        cashoutAccountNumber: "1234567890",
        cashoutAccountName: "Campus Cafe Ltd",
      },
      "u_admin",
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        id: "u_bbbbbbbbbbbbbbbb",
        email: "merchant@getoneto.com",
        role: Role.MERCHANT,
        status: Status.ACTIVE,
        merchantProfile: {
          create: {
            businessName: "Campus Cafe",
            businessAddress: "CU Plaza",
            cashoutBankName: "Wema Bank",
            cashoutBankCode: "035",
            cashoutAccountNumber: "1234567890",
            cashoutAccountName: "Campus Cafe Ltd",
            verifiedAt: expect.any(Date),
          },
        },
      },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      merchant: {
        userId: "u_merchant",
        email: "merchant@getoneto.com",
        status: Status.ACTIVE,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
        businessName: "Campus Cafe",
        businessAddress: "CU Plaza",
        cashoutBankName: "Wema Bank",
        cashoutBankCode: "035",
        cashoutAccountNumber: "1234567890",
        cashoutAccountName: "Campus Cafe Ltd",
        verifiedAt: "2026-05-18T00:00:00.000Z",
      },
    });
  });

  it("createMerchant rejects an existing email", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u_existing" });

    await expect(
      service.createMerchant(
        {
          email: "merchant@getoneto.com",
          businessName: "Campus Cafe",
          businessAddress: "CU Plaza",
          cashoutBankName: "Wema Bank",
          cashoutBankCode: "035",
          cashoutAccountNumber: "1234567890",
          cashoutAccountName: "Campus Cafe Ltd",
        },
        "u_admin",
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("createMerchant does not set or alter balances and does not create ledger entries", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(buildMerchantRecord());

    await service.createMerchant(
      {
        email: "merchant@getoneto.com",
        businessName: "Campus Cafe",
        businessAddress: "CU Plaza",
        cashoutBankName: "Wema Bank",
        cashoutBankCode: "035",
        cashoutAccountNumber: "1234567890",
        cashoutAccountName: "Campus Cafe Ltd",
      },
      "u_admin",
    );

    const createCall = prisma.user.create.mock.calls[0][0];
    expect(generateOnetoUserId).toHaveBeenCalledTimes(1);
    expect(createCall.data.id).toMatch(/^u_[0-9a-f]{16}$/);
    expect(createCall.data.verifiedBalanceKobo).toBeUndefined();
    expect(createCall.data.sequenceNumber).toBeUndefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("createMerchant rejects invalid email after normalization check", async () => {
    await expect(
      service.createMerchant(
        {
          email: "not-an-email",
          businessName: "Campus Cafe",
          businessAddress: "CU Plaza",
          cashoutBankName: "Wema Bank",
          cashoutBankCode: "035",
          cashoutAccountNumber: "1234567890",
          cashoutAccountName: "Campus Cafe Ltd",
        },
        "u_admin",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("updateMerchant updates only safe profile fields", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: "u_merchant",
        role: Role.MERCHANT,
        merchantProfile: {
          verifiedAt: new Date("2026-05-18T00:00:00.000Z"),
        },
      })
      .mockResolvedValueOnce(buildMerchantRecord({
        merchantProfile: {
          businessName: "Updated Cafe",
          businessAddress: "New Address",
          cashoutBankName: "Wema Bank",
          cashoutBankCode: "035",
          cashoutAccountNumber: "1234567890",
          cashoutAccountName: "Campus Cafe Ltd",
          verifiedAt: new Date("2026-05-18T00:00:00.000Z"),
        },
      }));

    const result = await service.updateMerchant(
      "u_merchant",
      {
        businessName: "Updated Cafe",
        businessAddress: "New Address",
        cashoutBankName: "Access Bank",
        cashoutBankCode: "044",
      },
      "u_admin",
    );

    expect(prisma.merchantProfile.update).toHaveBeenCalledWith({
      where: { userId: "u_merchant" },
      data: {
        businessName: "Updated Cafe",
        businessAddress: "New Address",
        cashoutBankName: "Access Bank",
        cashoutBankCode: "044",
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.merchant.businessName).toBe("Updated Cafe");
  });

  it("updateMerchant rejects non-merchant users", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_student",
      role: Role.STUDENT,
      merchantProfile: null,
    });

    await expect(
      service.updateMerchant("u_student", { businessName: "Updated" }, "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.merchantProfile.update).not.toHaveBeenCalled();
  });

  it("updateMerchant rejects missing merchant profile", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      merchantProfile: null,
    });

    await expect(
      service.updateMerchant("u_merchant", { businessName: "Updated" }, "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("deactivateMerchant sets status FROZEN and does not alter balances", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.ACTIVE,
      merchantProfile: {
        verifiedAt: new Date("2026-05-18T00:00:00.000Z"),
      },
    });

    const result = await service.deactivateMerchant("u_merchant", "u_admin");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u_merchant" },
      data: { status: Status.FROZEN },
    });
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      userId: "u_merchant",
      status: Status.FROZEN,
    });
  });

  it("reactivateMerchant sets status ACTIVE only for verified merchants", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.FROZEN,
      merchantProfile: {
        verifiedAt: new Date("2026-05-18T00:00:00.000Z"),
      },
    });

    const result = await service.reactivateMerchant("u_merchant", "u_admin");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u_merchant" },
      data: { status: Status.ACTIVE },
    });
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      userId: "u_merchant",
      status: Status.ACTIVE,
      verifiedAt: "2026-05-18T00:00:00.000Z",
    });
  });

  it("reactivateMerchant rejects unverified merchants", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.FROZEN,
      merchantProfile: {
        verifiedAt: null,
      },
    });

    await expect(
      service.reactivateMerchant("u_merchant", "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("approveMerchant rejects when user does not exist", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.approveMerchant("u_missing", "u_admin"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("approveMerchant rejects when user role is not MERCHANT", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_student",
      role: Role.STUDENT,
      merchantProfile: null,
    });

    await expect(
      service.approveMerchant("u_student", "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("approveMerchant sets ACTIVE and verifiedAt in one transaction callback", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.PENDING_VERIFICATION,
      merchantProfile: {
        verifiedAt: null,
      },
    });
    prisma.user.update.mockResolvedValue({});
    prisma.merchantProfile.update.mockResolvedValue({});

    const result = await service.approveMerchant("u_merchant", "u_admin");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u_merchant" },
      data: { status: Status.ACTIVE },
    });
    expect(prisma.merchantProfile.update).toHaveBeenCalledWith({
      where: { userId: "u_merchant" },
      data: expect.objectContaining({ verifiedAt: expect.any(Date) }),
    });
    expect(result.status).toBe(Status.ACTIVE);
    expect(result.verifiedAt).toEqual(expect.any(String));
  });

  it("approveMerchant rejects already approved merchants (non-idempotent)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.PENDING_VERIFICATION,
      merchantProfile: {
        verifiedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    });

    await expect(
      service.approveMerchant("u_merchant", "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("approveMerchant rejects FROZEN merchant even if verifiedAt is null", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.FROZEN,
      merchantProfile: {
        verifiedAt: null,
      },
    });

    await expect(
      service.approveMerchant("u_merchant", "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("approveMerchant rejects FLAGGED merchant even if verifiedAt is null", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u_merchant",
      role: Role.MERCHANT,
      status: Status.FLAGGED,
      merchantProfile: {
        verifiedAt: null,
      },
    });

    await expect(
      service.approveMerchant("u_merchant", "u_admin"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("getPendingCashouts filters to PENDING status", async () => {
    prisma.cashout.findMany.mockResolvedValue([
      {
        id: "c_1",
        merchantUserId: "u_m1",
        amountKobo: 5000n,
        grossAmountKobo: 5000n,
        onetoFeeBps: 250,
        onetoFeeKobo: 125n,
        korapayPayoutFeeKobo: null,
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
        korapayPayoutFeeDeductedFromRecipient: null,
        netPayoutKobo: null,
        korapayTransferAmountKobo: null,
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
      grossAmountKobo: "5000",
      onetoFeeBps: 250,
      onetoFeeKobo: "125",
      korapayPayoutFeeKobo: null,
      korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
      korapayPayoutFeeDeductedFromRecipient: null,
      netPayoutKobo: null,
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

  it("getOutboundIpDiagnostic returns IPv4 and auto-detected IP values when both providers succeed", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ip: "203.0.113.10" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ip: "2001:db8::10" }),
      } as Response);

    const result = await service.getOutboundIpDiagnostic();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ipv4: "203.0.113.10",
      auto: "2001:db8::10",
      checkedAt: expect.any(String),
    });
  });

  it("getOutboundIpDiagnostic returns null for a provider that fails while preserving the other provider result", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ip: "2001:db8::10" }),
      } as Response);

    const result = await service.getOutboundIpDiagnostic();

    expect(result).toEqual({
      ipv4: null,
      auto: "2001:db8::10",
      checkedAt: expect.any(String),
    });
  });

  it("getOutboundIpDiagnostic response does not expose secrets or extra fields", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ip: "203.0.113.10",
          token: "secret",
          authorization: "Bearer leaked",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ ip: "ignored" }),
      } as Response);

    const result = await service.getOutboundIpDiagnostic();

    expect(result.ipv4).toBe("203.0.113.10");
    expect(result.auto).toBeNull();
    expect(Object.keys(result).sort()).toEqual(["auto", "checkedAt", "ipv4"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("authorization");
  });
});
