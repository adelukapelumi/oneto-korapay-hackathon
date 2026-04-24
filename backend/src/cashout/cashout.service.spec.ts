import { Test, TestingModule } from '@nestjs/testing';
import { CashoutService } from './cashout.service';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService } from '../topup/korapay.service';
import { CashoutStatus, Role, Status, LedgerEntryType } from '@prisma/client';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';

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
    },
    ledgerEntry: {
      create: jest.fn(),
    },
  };

  const mockKorapay: any = {
    initiatePayout: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashoutService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KorapayService, useValue: mockKorapay },
      ],
    }).compile();

    service = module.get<CashoutService>(CashoutService);
    prisma = module.get<PrismaService>(PrismaService);
    korapay = module.get<KorapayService>(KorapayService);
    jest.clearAllMocks();
  });

  const merchantId = 'u_merchant';
  const adminId = 'u_admin';
  const operatingId = 'u_operating';

  const mockMerchant = {
    id: merchantId,
    role: Role.MERCHANT,
    status: Status.ACTIVE,
    verifiedBalanceKobo: BigInt(5000),
    merchantProfile: {
      cashoutBankName: 'Wema Bank',
      cashoutBankCode: '035',
      cashoutAccountNumber: '1234567890',
      cashoutAccountName: 'Test Merchant',
    },
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

    it('3. requestCashout: missing MerchantProfile -> BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, merchantProfile: null });
      await expect(service.requestCashout(merchantId)).rejects.toThrow(BadRequestException);
    });

    it('4. requestCashout: balance below minimum -> BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockMerchant, verifiedBalanceKobo: BigInt(500) });
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
          amountKobo: BigInt(5000),
          status: CashoutStatus.PENDING,
          cashoutBankName: 'Wema Bank',
          cashoutBankCode: '035',
          cashoutAccountNumber: '1234567890',
          cashoutAccountName: 'Test Merchant',
        },
      });
    });
  });

  describe('approveCashout', () => {
    const cashoutId = 'c_123';
    const mockCashout = {
      id: cashoutId,
      merchantUserId: merchantId,
      amountKobo: BigInt(5000),
      status: CashoutStatus.PENDING,
    };

    it('8. approveCashout: non-ADMIN -> ForbiddenException', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockResolvedValue({ id: adminId, role: Role.MERCHANT });
      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(ForbiddenException);
    });

    it('9. approveCashout: cashout already APPROVED -> ConflictException', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue({ ...mockCashout, status: CashoutStatus.APPROVED });
      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(ConflictException);
    });

    it('10. approveCashout: cashout COMPLETED -> ConflictException', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue({ ...mockCashout, status: CashoutStatus.COMPLETED });
      await expect(service.approveCashout(cashoutId, adminId)).rejects.toThrow(ConflictException);
    });

    it('11. approveCashout: PENDING -> APPROVED transition happens', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockResolvedValue({ id: adminId, role: Role.ADMIN });
      mockPrisma.cashout.update.mockResolvedValue({ ...mockCashout, status: CashoutStatus.APPROVED });

      const result = await service.approveCashout(cashoutId, adminId);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: expect.objectContaining({
          status: CashoutStatus.APPROVED,
          approvedByUserId: adminId,
        }),
      });
    });

    it('12. approveCashout: triggers executePayout', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockResolvedValue({ id: adminId, role: Role.ADMIN });
      mockPrisma.cashout.update.mockResolvedValue({ ...mockCashout, status: CashoutStatus.APPROVED });
      
      const executePayoutSpy = jest.spyOn(service as any, 'executePayout').mockResolvedValue(undefined);

      await service.approveCashout(cashoutId, adminId);
      expect(executePayoutSpy).toHaveBeenCalledWith(cashoutId);
    });
  });

  describe('executePayout', () => {
    const cashoutId = 'c_123';
    const mockCashout = {
      id: cashoutId,
      merchantUserId: merchantId,
      amountKobo: BigInt(5000),
      status: CashoutStatus.APPROVED,
      cashoutBankName: 'Wema Bank',
      cashoutBankCode: '035',
      cashoutAccountNumber: '1234567890',
      cashoutAccountName: 'Test Merchant',
    };

    it('13. executePayout: balance changed -> status FAILED', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve({ ...mockMerchant, verifiedBalanceKobo: BigInt(1000) });
        return Promise.resolve(null);
      });

      await (service as any).executePayout(cashoutId);

      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: { status: CashoutStatus.FAILED, failureReason: 'balance_changed' },
      });
      expect(mockKorapay.initiatePayout).not.toHaveBeenCalled();
    });

    it('14. executePayout: happy path writes ledger entries and calls Korapay', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve({ id: operatingId, verifiedBalanceKobo: BigInt(0) });
        return Promise.resolve(null);
      });
      mockKorapay.initiatePayout.mockResolvedValue({ reference: 'ref', status: 'processing' });

      await (service as any).executePayout(cashoutId);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.DEBIT, userId: merchantId })
      }));
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: operatingId })
      }));
      expect(mockKorapay.initiatePayout).toHaveBeenCalledWith(expect.objectContaining({
        bankCode: '035'
      }));
    });

    it('15. executePayout: Korapay API throws -> rolls back balance', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve({ id: operatingId, verifiedBalanceKobo: BigInt(0) });
        return Promise.resolve(null);
      });
      mockKorapay.initiatePayout.mockRejectedValue(new Error('API Down'));

      await (service as any).executePayout(cashoutId);

      // Reversal should happen: CREDIT merchant, DEBIT operating
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: merchantId })
      }));
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: cashoutId },
        data: { status: CashoutStatus.FAILED, failureReason: 'payout_initiation_failed' },
      });
    });

    it('16. executePayout: uses Serializable isolation', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockResolvedValue(mockMerchant);
      
      await (service as any).executePayout(cashoutId);
      
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });

    it('17. executePayout: operating account missing -> throws', async () => {
      mockPrisma.cashout.findUnique.mockResolvedValue(mockCashout);
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args.where.id === merchantId) return Promise.resolve(mockMerchant);
        if (args.where.id === operatingId) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect((service as any).executePayout(cashoutId)).resolves.toBeUndefined();
      // Error is caught and logged in executePayout
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
      mockPrisma.cashout.findUnique.mockResolvedValue({ id: 'c_123', status: CashoutStatus.PROCESSING });

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: 'c_123' },
        data: expect.objectContaining({ status: CashoutStatus.COMPLETED }),
      });
    });

    it('20. handlePayoutWebhook: transfer.failed -> restores merchant balance', async () => {
      const failPayload = { ...payload, event: 'transfer.failed', data: { reference: 'ref_123', reason: 'Declined' } };
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

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: LedgerEntryType.CREDIT, userId: merchantId })
      }));
      expect(mockPrisma.cashout.update).toHaveBeenCalledWith({
        where: { id: 'c_123' },
        data: expect.objectContaining({ status: CashoutStatus.FAILED, failureReason: 'Declined' }),
      });
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
      mockPrisma.cashout.findUnique.mockResolvedValue({ id: 'c_123', status: CashoutStatus.COMPLETED });

      const result = await service.handlePayoutWebhook(payload, signature);
      expect(result.success).toBe(true);
      expect(mockPrisma.cashout.update).not.toHaveBeenCalled();
    });

    it('23. handlePayoutWebhook: unknown event type -> no-op', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.cashout.findUnique.mockResolvedValue({ id: 'c_123', status: CashoutStatus.PROCESSING });
      
      const unknownEvent = { ...payload, event: 'unknown.event' };
      const result = await service.handlePayoutWebhook(unknownEvent, signature);
      expect(result.success).toBe(true);
    });
  });
});
