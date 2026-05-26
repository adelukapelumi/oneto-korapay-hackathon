import { Test, TestingModule } from '@nestjs/testing';
import { CashoutService } from './cashout.service';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayGatewayError, KorapayService } from '../topup/korapay.service';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  CashoutStatus,
  KorapayPayoutFeeBearer,
  Role,
  Status,
  LedgerEntryType,
} from '@prisma/client';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { AdminCashoutNotificationService } from './admin-cashout-notification.service';

describe('CashoutService', () => {
  let service: CashoutService;
  let prisma: PrismaService;
  let korapay: KorapayService;

  const mockPrisma: any = {
    $transaction: jest.fn((callback) => callback(mockPrisma)),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cashout: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
  };

  const mockKorapay: any = {
    initiatePayout: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    verifyTransaction: jest.fn(),
    extractPayoutFeeKobo: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockAdminCashoutNotificationService = {
    sendNewCashoutRequestNotification: jest.fn(),
  };

  let payoutMode: 'korapay_api' | 'manual' = 'korapay_api';

  beforeEach(async () => {
    payoutMode = 'korapay_api';
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'CASHOUT_PAYOUT_MODE') {
        return payoutMode;
      }
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashoutService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KorapayService, useValue: mockKorapay },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: AdminCashoutNotificationService,
          useValue: mockAdminCashoutNotificationService,
        },
      ],
    }).compile();

    service = module.get<CashoutService>(CashoutService);
    prisma = module.get<PrismaService>(PrismaService);
    korapay = module.get<KorapayService>(KorapayService);
    jest.clearAllMocks();
    mockPrisma.cashout.updateMany.mockResolvedValue({ count: 1 });
    mockKorapay.extractPayoutFeeKobo.mockReturnValue(null);
    mockAdminCashoutNotificationService.sendNewCashoutRequestNotification.mockResolvedValue(undefined);
  });

  const merchantId = 'u_merchant';
  const adminId = 'u_admin';
  const operatingId = 'u_operating';

  const mockMerchant = {
    id: merchantId,
    role: Role.MERCHANT,
    status: Status.ACTIVE,
    verifiedBalanceKobo: BigInt(500000),
    merchantProfile: {
      cashoutBankName: 'Wema Bank',
      cashoutBankCode: '035',
      cashoutAccountNumber: '1234567890',
      cashoutAccountName: 'Test Merchant',
      verifiedAt: new Date('2026-05-01T00:00:00.000Z'),
    },
  };

  const mockOperating = {
    id: operatingId,
    verifiedBalanceKobo: BigInt(100000),
  };

  describe('requestCashout', () => {
    it('1. requestCashout: non-MERCHANT role -> ForbiddenException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, role: Role.STUDENT });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ForbiddenException);
    });

    it('2. requestCashout: FROZEN merchant -> ForbiddenException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, status: Status.FROZEN });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ForbiddenException);
    });

    it('2b. requestCashout: FLAGGED merchant -> ForbiddenException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, status: Status.FLAGGED });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ForbiddenException);
    });

    it('2c. requestCashout: unapproved merchant -> ForbiddenException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockMerchant,
        merchantProfile: { ...mockMerchant.merchantProfile, verifiedAt: null },
      });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ForbiddenException);
    });

    it('3. requestCashout: missing MerchantProfile -> BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, merchantProfile: null });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(BadRequestException);
    });

    it('4. requestCashout: balance below minimum -> BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, verifiedBalanceKobo: BigInt(500) });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(BadRequestException);
    });

    it('4b. requestCashout: transfer amount below gateway minimum -> BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockMerchant,
        verifiedBalanceKobo: BigInt(51_000),
      });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(BadRequestException);
    });

    it('5. requestCashout: existing PENDING cashout -> ConflictException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.cashout.findFirst.mockResolvedValue({ id: 'existing', status: CashoutStatus.PENDING });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ConflictException);
    });

    it('6. requestCashout: existing APPROVED cashout -> ConflictException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.cashout.findFirst.mockResolvedValue({ id: 'existing', status: CashoutStatus.APPROVED });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(ConflictException);
    });

    it('7. requestCashout: happy path creates PENDING row', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.cashout.findFirst.mockResolvedValue(null);
      mockPrisma.cashout.create.mockResolvedValue({ id: 'new_cashout' });

      const result = await service.requestCashout(merchantId);
      expect(result.id).toBe('new_cashout');
      expect(mockPrisma.cashout.create).toHaveBeenCalledWith({
        data: {
          merchantUserId: merchantId,
          amountKobo: BigInt(500000),
          grossAmountKobo: BigInt(500000),
          onetoFeeBps: 250,
          onetoFeeKobo: BigInt(12500),
          korapayPayoutFeeKobo: null,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
          korapayPayoutFeeDeductedFromRecipient: null,
          netPayoutKobo: null,
          korapayTransferAmountKobo: BigInt(487500),
          status: CashoutStatus.PENDING,
          cashoutBankName: 'Wema Bank',
          cashoutBankCode: '035',
          cashoutAccountNumber: '1234567890',
          cashoutAccountName: 'Test Merchant',
        },
      });
    });

    it('requestCashout: NGN 10,000 gross gives NGN 250 Oneto fee with bigint math', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockMerchant,
        verifiedBalanceKobo: 1_000_000n,
      });
      mockPrisma.cashout.findFirst.mockResolvedValue(null);
      mockPrisma.cashout.create.mockResolvedValue({ id: 'new_cashout' });

      await service.requestCashout(merchantId);

      expect(mockPrisma.cashout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountKobo: 1_000_000n,
          grossAmountKobo: 1_000_000n,
          onetoFeeBps: 250,
          onetoFeeKobo: 25_000n,
          korapayPayoutFeeKobo: null,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
          korapayPayoutFeeDeductedFromRecipient: null,
          netPayoutKobo: null,
          korapayTransferAmountKobo: 975_000n,
        }),
      });
    });

    it('requestCashout sends admin cashout notification after successful create', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.cashout.findFirst.mockResolvedValue(null);
      mockPrisma.cashout.create.mockResolvedValue({
        id: 'cashout_notify_1',
        merchantUserId: merchantId,
        amountKobo: 500_000n,
        grossAmountKobo: 500_000n,
        onetoFeeKobo: 12_500n,
        korapayTransferAmountKobo: 487_500n,
        cashoutBankName: 'Wema Bank',
        cashoutAccountName: 'Test Merchant',
        cashoutAccountNumber: '1234567890',
      });

      await service.requestCashout(merchantId);

      expect(
        mockAdminCashoutNotificationService.sendNewCashoutRequestNotification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          cashoutId: 'cashout_notify_1',
          merchantUserId: merchantId,
          amountToPayKobo: 487_500n,
          grossAmountKobo: 500_000n,
          onetoFeeKobo: 12_500n,
        }),
      );
    });

    it('requestCashout does not fail when admin cashout notification send fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      mockPrisma.cashout.findFirst.mockResolvedValue(null);
      mockPrisma.cashout.create.mockResolvedValue({
        id: 'cashout_notify_2',
        merchantUserId: merchantId,
        amountKobo: 500_000n,
        grossAmountKobo: 500_000n,
        onetoFeeKobo: 12_500n,
        korapayTransferAmountKobo: 487_500n,
        cashoutBankName: 'Wema Bank',
        cashoutAccountName: 'Test Merchant',
        cashoutAccountNumber: '1234567890',
      });
      mockAdminCashoutNotificationService.sendNewCashoutRequestNotification.mockRejectedValue(
        new Error('mail_down'),
      );

      await expect(service.requestCashout(merchantId)).resolves.toEqual(
        expect.objectContaining({ id: 'cashout_notify_2' }),
      );
    });

  });

  describe('approveCashout', () => {
    const cashoutId = 'c_123';
    const mockCashout = {
      id: cashoutId,
      merchantUserId: merchantId,
      amountKobo: BigInt(500000),
      grossAmountKobo: BigInt(500000),
      onetoFeeBps: 250,
      onetoFeeKobo: BigInt(12500),
      korapayPayoutFeeKobo: null,
      korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
      korapayPayoutFeeDeductedFromRecipient: null,
      netPayoutKobo: null,
      korapayTransferAmountKobo: null,
      status: CashoutStatus.PENDING,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === adminId) return Promise.resolve({ id: adminId, role: Role.ADMIN });
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve(mockOperating);
        return Promise.resolve(null);
      });
      mockPrisma.cashout.update.mockResolvedValue(mockCashout);
    });

    it('8. approveCashout: non-ADMIN -> ForbiddenException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: adminId, role: Role.MERCHANT });
      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('9. approveCashout: cashout already PROCESSING/APPROVED/COMPLETED -> BadRequestException (P2025)', async () => {
      mockPrisma.cashout.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: '5.x' }),
      );
      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('11. approveCashout: PENDING -> PROCESSING transition happens in transaction', async () => {
      const result = await service.approveCashout(cashoutId, adminId);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId, status: CashoutStatus.PENDING },
        data: expect.objectContaining({
          status: CashoutStatus.PROCESSING,
          approvedByUserId: adminId,
          korapayReference: expect.stringContaining('cashout_'),
        }),
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });

    it('12. approveCashout: triggers initiateKorapayPayout', async () => {
      const initiateKorapayPayoutSpy = jest.spyOn(service as any, 'initiateKorapayPayout').mockResolvedValue(undefined);

      await service.approveCashout(cashoutId, adminId);
      expect(initiateKorapayPayoutSpy).toHaveBeenCalledWith(cashoutId, expect.stringContaining('cashout_'));
    });

    it('manual mode approve does not call Korapay payout initiation', async () => {
      payoutMode = 'manual';
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CashoutService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KorapayService, useValue: mockKorapay },
          { provide: ConfigService, useValue: mockConfigService },
          {
            provide: AdminCashoutNotificationService,
            useValue: mockAdminCashoutNotificationService,
          },
        ],
      }).compile();
      service = module.get<CashoutService>(CashoutService);

      const initiateKorapayPayoutSpy = jest
        .spyOn(service as any, 'initiateKorapayPayout')
        .mockResolvedValue(undefined);

      await service.approveCashout(cashoutId, adminId);

      expect(initiateKorapayPayoutSpy).not.toHaveBeenCalled();
    });

    it('manual mode approve reserves merchant and operating balances exactly once and stores transfer amount', async () => {
      payoutMode = 'manual';
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CashoutService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KorapayService, useValue: mockKorapay },
          { provide: ConfigService, useValue: mockConfigService },
          {
            provide: AdminCashoutNotificationService,
            useValue: mockAdminCashoutNotificationService,
          },
        ],
      }).compile();
      service = module.get<CashoutService>(CashoutService);

      await service.approveCashout(cashoutId, adminId);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cashoutId },
          data: expect.objectContaining({
            korapayTransferAmountKobo: 487_500n,
          }),
        }),
      );
    });

    it('approveCashout: race condition — second admin gets P2025, no payout fired', async () => {
      mockPrisma.cashout.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: '5.x' }),
      );
      const initiateKorapayPayoutSpy = jest.spyOn(service as any, 'initiateKorapayPayout').mockResolvedValue(undefined);

      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(BadRequestException);
      expect(initiateKorapayPayoutSpy).not.toHaveBeenCalled();
    });

    it('Atomic transaction test: Mock the inner transaction to throw mid-way', async () => {
      // Throw mid-way: operating account missing
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === adminId) return Promise.resolve({ id: adminId, role: Role.ADMIN });
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve(null); // MISSING
        return Promise.resolve(null);
      });

      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(BadRequestException);
      // Ensure no balance updates or ledger entries happened (they were inside tx)
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockKorapay.initiatePayout).not.toHaveBeenCalled();
    });

    it('Insufficient Merchant Balance: rollback and throw BadRequest', async () => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === adminId) return Promise.resolve({ id: adminId, role: Role.ADMIN });
        if (args.where.id === merchantId) return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: BigInt(100000) });
        if (args.where.id === operatingId) return Promise.resolve(mockOperating);
        return Promise.resolve(null);
      });

      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('approveCashout: happy path — WHERE includes both id and status PENDING (regression)', async () => {
      // Regression: verify the atomic conditional update pattern is correct
      await service.approveCashout(cashoutId, adminId);

      const updateCall = mockPrisma.cashout.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: cashoutId, status: CashoutStatus.PENDING });
      expect(updateCall.data.status).toBe(CashoutStatus.PROCESSING);
      expect(updateCall.data.approvedByUserId).toBe(adminId);
      expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
      expect(updateCall.data.korapayReference).toEqual(expect.stringContaining('cashout_'));
    });

    it('approveCashout: uses Serializable isolation level', async () => {
      await service.approveCashout(cashoutId, adminId);
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });

    it('Happy path: status PROCESSING, balances updated, Korapay called', async () => {
      const result = await service.approveCashout(cashoutId, adminId);
      expect(result.success).toBe(true);

      // Verify merchant debit
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: merchantId },
        data: { verifiedBalanceKobo: BigInt(0) },
      });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: merchantId, type: LedgerEntryType.DEBIT })
      }));

      // Verify operating credit
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: operatingId },
        data: { verifiedBalanceKobo: mockOperating.verifiedBalanceKobo + BigInt(500000) },
      });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: operatingId, type: LedgerEntryType.CREDIT })
      }));
    });
  });

  describe('markManualCashoutPaid', () => {
    const cashoutId = 'c_manual_paid';

    beforeEach(() => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === adminId) return Promise.resolve({ id: adminId, role: Role.ADMIN });
        return Promise.resolve(null);
      });
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: cashoutId,
        status: CashoutStatus.PROCESSING,
        korapayResponse: {
          source: 'manual_payout_required',
          payoutMode: 'manual',
          amountToPayKobo: '487500',
          approvedByUserId: adminId,
          approvedAt: '2026-05-26T10:00:00.000Z',
        },
      });
      mockPrisma.cashout.updateMany.mockResolvedValue({ count: 1 });
    });

    it('mark-paid completes manual cashout without creating extra ledger entries', async () => {
      const result = await service.markManualCashoutPaid(cashoutId, adminId, {
        externalReference: 'bank_ref_123',
        note: 'settled manually',
      });

      expect(result.status).toBe(CashoutStatus.COMPLETED);
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cashoutId, status: CashoutStatus.PROCESSING },
          data: expect.objectContaining({
            status: CashoutStatus.COMPLETED,
            failureReason: null,
            korapayResponse: expect.objectContaining({
              source: 'manual_payout_required',
              manualPayoutResponse: expect.objectContaining({
                source: 'manual_payout',
                externalReference: 'bank_ref_123',
              }),
            }),
          }),
        }),
      );
    });

    it('mark-paid requires external reference', async () => {
      await expect(
        service.markManualCashoutPaid(cashoutId, adminId, {
          externalReference: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('duplicate mark-paid does not create money side effects', async () => {
      mockPrisma.cashout.findUnique
        .mockResolvedValueOnce({
          id: cashoutId,
          status: CashoutStatus.PROCESSING,
          korapayResponse: {
            source: 'manual_payout_required',
            payoutMode: 'manual',
            amountToPayKobo: '487500',
            approvedByUserId: adminId,
            approvedAt: '2026-05-26T10:00:00.000Z',
          },
        })
        .mockResolvedValueOnce({
          id: cashoutId,
          status: CashoutStatus.COMPLETED,
          korapayResponse: {
            source: 'manual_payout_required',
            payoutMode: 'manual',
            amountToPayKobo: '487500',
            approvedByUserId: adminId,
            approvedAt: '2026-05-26T10:00:00.000Z',
          },
        });

      await service.markManualCashoutPaid(cashoutId, adminId, {
        externalReference: 'bank_ref_123',
      });

      await expect(
        service.markManualCashoutPaid(cashoutId, adminId, {
          externalReference: 'bank_ref_123',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelManualCashout', () => {
    const cashoutId = 'c_manual_cancel';

    beforeEach(() => {
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === adminId) return Promise.resolve({ id: adminId, role: Role.ADMIN });
        if (args.where.id === merchantId) {
          return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: 0n });
        }
        if (args.where.id === operatingId) {
          return Promise.resolve({ id: operatingId, verifiedBalanceKobo: 600_000n });
        }
        return Promise.resolve(null);
      });
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: cashoutId,
        merchantUserId: merchantId,
        amountKobo: 500_000n,
        grossAmountKobo: 500_000n,
        korapayReference: 'cashout_manual_ref',
        status: CashoutStatus.PROCESSING,
        korapayResponse: {
          source: 'manual_payout_required',
          payoutMode: 'manual',
          amountToPayKobo: '487500',
          approvedByUserId: adminId,
          approvedAt: '2026-05-26T10:00:00.000Z',
        },
      });
      mockPrisma.cashout.updateMany.mockResolvedValue({ count: 1 });
    });

    it('cancel-manual reverses reservation exactly once', async () => {
      const result = await service.cancelManualCashout(cashoutId, adminId);

      expect(result.status).toBe(CashoutStatus.FAILED);
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cashoutId, status: CashoutStatus.PROCESSING },
          data: expect.objectContaining({
            status: CashoutStatus.FAILED,
            failureReason: 'manual_payout_cancelled',
          }),
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('duplicate cancel-manual does not double refund', async () => {
      mockPrisma.cashout.findUnique
        .mockResolvedValueOnce({
          id: cashoutId,
          merchantUserId: merchantId,
          amountKobo: 500_000n,
          grossAmountKobo: 500_000n,
          korapayReference: 'cashout_manual_ref',
          status: CashoutStatus.PROCESSING,
          korapayResponse: {
            source: 'manual_payout_required',
            payoutMode: 'manual',
            amountToPayKobo: '487500',
            approvedByUserId: adminId,
            approvedAt: '2026-05-26T10:00:00.000Z',
          },
        })
        .mockResolvedValueOnce({
          id: cashoutId,
          merchantUserId: merchantId,
          amountKobo: 500_000n,
          grossAmountKobo: 500_000n,
          korapayReference: 'cashout_manual_ref',
          status: CashoutStatus.FAILED,
          korapayResponse: {
            source: 'manual_payout_required',
            payoutMode: 'manual',
            amountToPayKobo: '487500',
            approvedByUserId: adminId,
            approvedAt: '2026-05-26T10:00:00.000Z',
          },
        });

      await service.cancelManualCashout(cashoutId, adminId);

      await expect(service.cancelManualCashout(cashoutId, adminId)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('recoverStuckCashouts', () => {
    it('does not call charge verification for payout references', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      mockPrisma.cashout.findMany.mockResolvedValue([
        {
          id: 'c_stuck',
          merchantUserId: merchantId,
          amountKobo: 5_000n,
          grossAmountKobo: 5_000n,
          onetoFeeKobo: 125n,
          korapayReference: 'cashout_ref_123',
          status: CashoutStatus.PROCESSING,
        },
      ]);

      await service.recoverStuckCashouts();

      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.cashout.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cashoutId: 'c_stuck',
          korapayReference: 'cashout_ref_123',
        }),
        'Cashout payout recovery skipped: payout verification endpoint is not configured',
      );
    });

    it('leaves PROCESSING cashout untouched when payout verification is unavailable', async () => {
      mockKorapay.verifyTransaction.mockResolvedValue({ status: 'not_found' });
      mockPrisma.cashout.findMany.mockResolvedValue([
        {
          id: 'c_processing',
          merchantUserId: merchantId,
          amountKobo: 5_000n,
          korapayReference: 'cashout_ref_missing_from_charges',
          status: CashoutStatus.PROCESSING,
        },
      ]);
      jest
        .spyOn((service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.recoverStuckCashouts();

      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.cashout.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CashoutStatus.FAILED }),
        }),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('initiateKorapayPayout', () => {
    const cashoutId = 'c_123';
    const korapayRef = 'cashout_ref_123';
    const mockCashout = {
      id: cashoutId,
      merchantUserId: merchantId,
      amountKobo: BigInt(500000),
      grossAmountKobo: BigInt(500000),
      onetoFeeBps: 250,
      onetoFeeKobo: BigInt(12500),
      korapayPayoutFeeKobo: null,
      korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
      korapayPayoutFeeDeductedFromRecipient: null,
      netPayoutKobo: null,
      korapayTransferAmountKobo: BigInt(487500),
      status: CashoutStatus.PROCESSING,
      cashoutBankName: 'Wema Bank',
      cashoutBankCode: '035',
      cashoutAccountNumber: '1234567890',
      cashoutAccountName: 'Test Merchant',
      merchant: {
        email: 'merchant@cu.edu.ng',
      },
    };

    beforeEach(() => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve(mockOperating);
        return Promise.resolve(null);
      });
    });

    it('initiates Korapay payout with gross minus Oneto fee while payout fee is unknown', async () => {
      mockKorapay.initiatePayout.mockResolvedValue({
        reference: korapayRef,
        status: 'processing',
        payoutFeeKobo: null,
        rawResponse: { status: true, data: { reference: korapayRef, status: 'processing' } },
      });

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockKorapay.initiatePayout).toHaveBeenCalledWith(expect.objectContaining({
        reference: korapayRef,
        amountKobo: 487500,
        customerName: 'Test Merchant',
        customerEmail: 'merchant@cu.edu.ng',
      }));
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: expect.objectContaining({
          korapayPayoutFeeKobo: null,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
          korapayPayoutFeeDeductedFromRecipient: null,
          korapayTransferAmountKobo: 487500n,
          netPayoutKobo: null,
        }),
      });
    });

    it('stores returned Korapay payout fee as Oneto processor expense when recipient deduction is not confirmed', async () => {
      mockKorapay.initiatePayout.mockResolvedValue({
        reference: korapayRef,
        status: 'processing',
        payoutFeeKobo: 2_500n,
        rawResponse: {
          status: true,
          data: { reference: korapayRef, status: 'processing', fee: '25.00' },
        },
      });

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: expect.objectContaining({
          korapayPayoutFeeKobo: 2_500n,
          korapayTransferAmountKobo: 487_500n,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.ONETO,
          korapayPayoutFeeDeductedFromRecipient: false,
          netPayoutKobo: 487_500n,
          korapayResponse: expect.objectContaining({
            data: expect.objectContaining({ fee: '25.00' }),
          }),
        }),
      });
    });

    it('treats Korapay payout fee as merchant-borne only with explicit recipient-deduction proof', async () => {
      mockKorapay.initiatePayout.mockResolvedValue({
        reference: korapayRef,
        status: 'processing',
        payoutFeeKobo: 2_500n,
        rawResponse: {
          status: true,
          data: {
            reference: korapayRef,
            status: 'processing',
            fee: '25.00',
            fee_deducted_from_recipient: true,
          },
        },
      });

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: expect.objectContaining({
          korapayPayoutFeeKobo: 2_500n,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.MERCHANT,
          korapayPayoutFeeDeductedFromRecipient: true,
          netPayoutKobo: 485_000n,
        }),
      });
    });

    it('Korapay API Immediate Failure: compensating entries, status FAILED', async () => {
      mockKorapay.initiatePayout.mockRejectedValue(new Error('API Down'));

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      // Reversal should happen: CREDIT merchant, DEBIT operating
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: merchantId, amountKobo: 500000n })
      }));
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.DEBIT, userId: operatingId, amountKobo: 500000n })
      }));
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: cashoutId, status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({
          status: CashoutStatus.FAILED,
          failureReason: 'payout_gateway_error',
          korapayResponse: expect.objectContaining({
            errorType: 'payout_initiation_error',
          }),
        }),
      });
    });

    it('Korapay timeout error: compensating entries and FAILED status (no false success)', async () => {
      mockKorapay.initiatePayout.mockRejectedValue(
        new Error('Korapay request timed out after 10000ms'),
      );

      const cashoutServiceWithPrivateMethod = service as unknown as {
        initiateKorapayPayout: (cashoutId: string, korapayRef: string) => Promise<void>;
      };
      await cashoutServiceWithPrivateMethod.initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: merchantId, amountKobo: 500000n })
      }));
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.DEBIT, userId: operatingId })
      }));
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: cashoutId, status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({
          status: CashoutStatus.FAILED,
          failureReason: 'payout_gateway_error',
        }),
      });
    });

    it('stores structured Korapay rejection diagnostics on failed payout initiation', async () => {
      mockKorapay.initiatePayout.mockRejectedValue(
        new KorapayGatewayError({
          message: 'Korapay payout rejected request with HTTP 422',
          category: 'http_error',
          statusCode: 422,
          responseBody: {
            status: false,
            message: 'Invalid account number',
          },
        }),
      );

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: cashoutId, status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({
          status: CashoutStatus.FAILED,
          failureReason: 'payout_gateway_invalid_bank_account',
          korapayResponse: expect.objectContaining({
            errorType: 'korapay_gateway_error',
            category: 'http_error',
            statusCode: 422,
            responseBody: expect.objectContaining({
              message: 'Invalid account number',
            }),
          }),
        }),
      });
    });

    it('fails safely for missing merchant email, never calls Korapay, and reverses exactly once', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue({
        ...mockCashout,
        merchant: { email: 'not-an-email' },
      });
      mockPrisma.cashout.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);
      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockKorapay.initiatePayout).not.toHaveBeenCalled();
      expect(mockPrisma.cashout.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: cashoutId, status: CashoutStatus.PROCESSING },
          data: expect.objectContaining({
            status: CashoutStatus.FAILED,
            failureReason: 'payout_merchant_email_invalid',
            korapayResponse: expect.objectContaining({
              errorType: 'payout_precondition_error',
              code: 'merchant_email_missing_or_invalid',
            }),
          }),
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('refunds merchant gross balance exactly once when initiation failure handler runs more than once', async () => {
      mockKorapay.initiatePayout.mockRejectedValue(new Error('API Down'));
      mockPrisma.cashout.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);
      await (service as any).initiateKorapayPayout(cashoutId, korapayRef);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('handlePayoutWebhook', () => {
    const payload = {
      event: 'transfer.success',
      data: {
        reference: 'ref_123',
        status: 'success',
      },
    };
    const signature = 'valid_sig';

    it('18. handlePayoutWebhook: invalid signature -> ForbiddenException', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handlePayoutWebhook(payload, signature)).rejects.toThrow(ForbiddenException);
    });

    it('19. handlePayoutWebhook: transfer.success -> status COMPLETED', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        amountKobo: 5000n,
        grossAmountKobo: 5000n,
        onetoFeeKobo: 125n,
        korapayPayoutFeeKobo: null,
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
        korapayPayoutFeeDeductedFromRecipient: null,
        korapayTransferAmountKobo: 4_875n,
        status: CashoutStatus.PROCESSING,
      });

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: 'c_123', status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({ status: CashoutStatus.COMPLETED }),
      });
    });

    it('transfer.success webhook with fee but no deduction proof records fee as Oneto processor expense', async () => {
      const successPayload = {
        event: 'transfer.success',
        data: {
          reference: 'ref_123',
          status: 'success',
          fee: '25.00',
        },
      };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.extractPayoutFeeKobo.mockReturnValue(2_500n);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        amountKobo: 1_000_000n,
        grossAmountKobo: 1_000_000n,
        onetoFeeKobo: 25_000n,
        korapayPayoutFeeKobo: null,
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
        korapayPayoutFeeDeductedFromRecipient: null,
        korapayTransferAmountKobo: 975_000n,
        status: CashoutStatus.PROCESSING,
      });

      await service.handlePayoutWebhook(successPayload, signature);

      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: 'c_123', status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({
          status: CashoutStatus.COMPLETED,
          korapayPayoutFeeKobo: 2_500n,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.ONETO,
          korapayPayoutFeeDeductedFromRecipient: false,
          korapayTransferAmountKobo: 975_000n,
          netPayoutKobo: 975_000n,
          korapayResponse: expect.objectContaining({
            data: expect.objectContaining({ fee: '25.00' }),
          }),
        }),
      });
    });

    it('transfer.success webhook with explicit deduction proof calculates merchant-borne net payout', async () => {
      const successPayload = {
        event: 'transfer.success',
        data: {
          reference: 'ref_123',
          status: 'success',
          fee: '25.00',
          fee_deducted_from_recipient: true,
        },
      };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.extractPayoutFeeKobo.mockReturnValue(2_500n);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        amountKobo: 1_000_000n,
        grossAmountKobo: 1_000_000n,
        onetoFeeKobo: 25_000n,
        korapayPayoutFeeKobo: null,
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
        korapayPayoutFeeDeductedFromRecipient: null,
        korapayTransferAmountKobo: 975_000n,
        status: CashoutStatus.PROCESSING,
      });

      await service.handlePayoutWebhook(successPayload, signature);

      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: 'c_123', status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({
          status: CashoutStatus.COMPLETED,
          korapayPayoutFeeKobo: 2_500n,
          korapayPayoutFeeBearer: KorapayPayoutFeeBearer.MERCHANT,
          korapayPayoutFeeDeductedFromRecipient: true,
          netPayoutKobo: 972_500n,
        }),
      });
    });

    it('20. handlePayoutWebhook: transfer.failed -> restores merchant balance', async () => {
      const failPayload = { ...payload, event: 'transfer.failed', data: { reference: 'ref_123', status: 'failed', reason: 'Declined' } };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        merchantUserId: merchantId,
        amountKobo: BigInt(5000),
        status: CashoutStatus.PROCESSING,
      });
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: BigInt(0) });
        if (args.where.id === operatingId) return Promise.resolve({ id: operatingId, verifiedBalanceKobo: BigInt(5000) });
        return Promise.resolve(null);
      });

      await service.handlePayoutWebhook(failPayload, signature);

      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: 'c_123', status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({ status: CashoutStatus.FAILED, failureReason: 'Declined' }),
      });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: merchantId })
      }));
    });

    it('21. handlePayoutWebhook: unknown korapayReference -> no-op', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue(null);

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).not.toHaveBeenCalled();
    });

    it('22. handlePayoutWebhook: duplicate webhook (already COMPLETED) -> no-op', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        amountKobo: 5000n,
        grossAmountKobo: 5000n,
        onetoFeeKobo: 125n,
        korapayPayoutFeeKobo: null,
        status: CashoutStatus.COMPLETED,
      });
      mockPrisma.cashout.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('23. handlePayoutWebhook: unknown event type -> no-op', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({ id: 'c_123', status: CashoutStatus.PROCESSING });
      
      const unknownEvent = { ...payload, event: 'unknown.event' };
      const result = await service.handlePayoutWebhook(unknownEvent, signature);
      expect(result.success).toBe(true);
    });

    it('detects event/status mismatch in webhook (Fix 3)', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const spoofPayload = {
        event: 'transfer.success',
        data: {
          reference: 'ref_123',
          status: 'failed', // mismatch
        },
      };

      const result = await service.handlePayoutWebhook(spoofPayload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).not.toHaveBeenCalled();
    });

    it('duplicate transfer.failed webhook refunds merchant only once', async () => {
      const failPayload = {
        ...payload,
        event: 'transfer.failed',
        data: { reference: 'ref_123', status: 'failed', reason: 'Declined' },
      };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        merchantUserId: merchantId,
        amountKobo: BigInt(5000),
        status: CashoutStatus.PROCESSING,
      });
      mockPrisma.cashout.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: BigInt(0) });
        if (args.where.id === operatingId) return Promise.resolve({ id: operatingId, verifiedBalanceKobo: BigInt(5000) });
        return Promise.resolve(null);
      });

      const first = await service.handlePayoutWebhook(failPayload, signature);
      const second = await service.handlePayoutWebhook(failPayload, signature);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('concurrent transfer.failed webhook simulation refunds only once', async () => {
      const failPayload = {
        ...payload,
        event: 'transfer.failed',
        data: { reference: 'ref_123', status: 'failed', reason: 'Declined' },
      };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        merchantUserId: merchantId,
        amountKobo: BigInt(5000),
        status: CashoutStatus.PROCESSING,
      });
      mockPrisma.cashout.updateMany
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { count: 1 };
        })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: BigInt(0) });
        if (args.where.id === operatingId) return Promise.resolve({ id: operatingId, verifiedBalanceKobo: BigInt(5000) });
        return Promise.resolve(null);
      });

      const [r1, r2] = await Promise.all([
        service.handlePayoutWebhook(failPayload, signature),
        service.handlePayoutWebhook(failPayload, signature),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('transfer.failed after terminal status is idempotent no-op', async () => {
      const failPayload = {
        ...payload,
        event: 'transfer.failed',
        data: { reference: 'ref_123', status: 'failed', reason: 'Declined' },
      };
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        merchantUserId: merchantId,
        amountKobo: BigInt(5000),
        status: CashoutStatus.FAILED,
      });
      mockPrisma.cashout.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.handlePayoutWebhook(failPayload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('transfer.success after terminal status does not mutate again', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({
        id: 'c_123',
        amountKobo: 5000n,
        grossAmountKobo: 5000n,
        onetoFeeKobo: 125n,
        korapayPayoutFeeKobo: null,
        status: CashoutStatus.COMPLETED,
      });
      mockPrisma.cashout.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.updateMany).toHaveBeenCalledWith({
        where: { id: 'c_123', status: CashoutStatus.PROCESSING },
        data: expect.objectContaining({ status: CashoutStatus.COMPLETED }),
      });
      expect(mockPrisma.cashout.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
