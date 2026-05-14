import { Test, TestingModule } from '@nestjs/testing';
import { TopupService } from './topup.service';
import { KorapayService } from './korapay.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { Prisma, LedgerEntryType } from '@prisma/client';
import { MAX_USER_BALANCE_KOBO } from '@oneto/shared';

describe('TopupService', () => {
  let service: TopupService;
  let korapayService: KorapayService;
  let prismaService: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentTopup: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockKorapay = {
    initiateCheckout: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KorapayService, useValue: mockKorapay },
      ],
    }).compile();

    service = module.get<TopupService>(TopupService);
    korapayService = module.get<KorapayService>(KorapayService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Baseline behavior for tests that don't care about pending-topup lookup.
    mockPrisma.paymentTopup.findUnique.mockResolvedValue(null);
    mockPrisma.paymentTopup.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('initiate', () => {
    it('generates unique reference, calls korapayService, returns paymentUrl', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });
      mockKorapay.initiateCheckout.mockResolvedValue({ paymentUrl: 'https://pay.com' });

      const result = await service.initiate('u_123', 50000);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u_123' } });
      expect(mockKorapay.initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({
        amountKobo: 50000,
        customerEmail: 'test@cu.edu.ng',
        reference: expect.stringMatching(/^top_[a-f0-9]{24}$/),
      }));
      expect(result.paymentUrl).toBe('https://pay.com');
      expect(result.reference).toMatch(/^top_[a-f0-9]{24}$/);
    });

    it('rejects amountKobo below 10000 (100 NGN minimum)', async () => {
      await expect(service.initiate('u_123', 9999)).rejects.toThrow(BadRequestException);
    });

    it('rejects amountKobo above 100000000 (1M NGN maximum)', async () => {
      await expect(service.initiate('u_123', 100000001)).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleWebhook', () => {
    it('rejects when signature verify returns false', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handleWebhook({ data: {} }, 'bad-sig')).rejects.toThrow(UnauthorizedException);
    });

    it('charge.success: creates PaymentTopup, credits user, and debits u_operating', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      mockPrisma.user.update.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123') return { verifiedBalanceKobo: BigInt(50000) };
        if (where.id === 'u_operating') return { verifiedBalanceKobo: BigInt(-50000) };
        return {};
      });
      
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await service.handleWebhook(payload, 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u_123' },
        data: { verifiedBalanceKobo: { increment: BigInt(50000) } },
      }));
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u_operating' },
        data: { verifiedBalanceKobo: { decrement: BigInt(50000) } },
      }));
    });

    it('charge.success: writes two ledger entries with the SAME transactionId', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      mockPrisma.user.update.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123') return { verifiedBalanceKobo: BigInt(50000) };
        if (where.id === 'u_operating') return { verifiedBalanceKobo: BigInt(-50000) };
        return {};
      });
      
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await service.handleWebhook(payload, 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          transactionId: 'top_123',
          userId: 'u_123',
          type: LedgerEntryType.CREDIT,
        }),
      }));
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          transactionId: 'top_123',
          userId: 'u_operating',
          type: LedgerEntryType.DEBIT,
        }),
      }));
    });

    it('charge.success: rolls back if u_operating does not exist', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_missing_op', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') {
          return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        }
        if (where.id === 'u_operating') {
          return null; // missing!
        }
        return null;
      });

      mockPrisma.user.update.mockClear();

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });

      await expect(service.handleWebhook(payload, 'good-sig')).rejects.toThrow(InternalServerErrorException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('charge.success: transaction throws non-P2002 error → throws 500', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      mockPrisma.$transaction.mockRejectedValue(new Error('DB crash'));

      await expect(service.handleWebhook(payload, 'good-sig')).rejects.toThrow(InternalServerErrorException);
    });

    it('charge.success with duplicate reference: returns success idempotently WITHOUT double-crediting', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });
      
      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['reference'] }
      });
      mockPrisma.$transaction.mockRejectedValue(p2002Error);

      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
    });

    it('charge.success with unknown email: logs, returns success, no balance change', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'unknown@test.com' } },
      };
      
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('charge.failed: upserts FAILED PaymentTopup, no balance change', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.failed',
        data: { reference: 'top_fail', amount: 500, status: 'failed', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { reference: 'top_fail' },
        update: expect.objectContaining({
          status: 'FAILED',
        }),
        create: expect.objectContaining({
          reference: 'top_fail',
          userId: 'u_123',
          amountKobo: BigInt(50000),
          status: 'FAILED',
        }),
      }));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled(); // No transaction for failures
    });

    it('unknown event: logs, returns success, no DB writes', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = { event: 'transfer.success', data: { reference: 'some-ref', amount: 100 } };
      
      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.upsert).not.toHaveBeenCalled();
    });

    it('detects event/status mismatch in webhook (Fix 3)', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const spoofPayload = {
        event: 'charge.success',
        data: {
          reference: 'top_123',
          status: 'failed', // mismatch
          amount: 500,
          customer: { email: 'test@cu.edu.ng' }
        },
      };

      const result = await service.handleWebhook(spoofPayload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('charge.success: fails if user balance would exceed cap', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const amount = 500; // 50000 kobo
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_cap_exceeded', amount, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') {
          // Current balance is already at cap minus 1000 kobo
          return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(MAX_USER_BALANCE_KOBO - 1000) };
        }
        return null;
      });

      mockPrisma.paymentTopup.update.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await service.handleWebhook(payload, 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { reference: 'top_cap_exceeded' },
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      }));
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('charge.success: succeeds if user balance reaches exactly the cap', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const amount = 500; // 50000 kobo
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_at_cap', amount, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') {
          // Balance after topup will be exactly MAX_USER_BALANCE_KOBO
          return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(MAX_USER_BALANCE_KOBO - 50000) };
        }
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      mockPrisma.user.update.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123') return { verifiedBalanceKobo: BigInt(MAX_USER_BALANCE_KOBO) };
        if (where.id === 'u_operating') return { verifiedBalanceKobo: BigInt(-MAX_USER_BALANCE_KOBO) };
        return {};
      });
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await service.handleWebhook(payload, 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u_123' },
        data: { verifiedBalanceKobo: { increment: BigInt(50000) } },
      }));
    });

    it('rejects malformed payload (missing reference) with BadRequestException', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const malformedPayload = {
        event: 'charge.success',
        data: { amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
        // missing data.reference
      };

      await expect(service.handleWebhook(malformedPayload, 'good-sig')).rejects.toThrow(BadRequestException);
    });

    it('accepts payload with extra unknown fields (passthrough)', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const extraFieldsPayload = {
        event: 'charge.success',
        data: { 
          reference: 'top_extra', 
          amount: 500, 
          status: 'success', 
          customer: { email: 'test@cu.edu.ng' },
          extra_internal_field: 'should-be-allowed' 
        },
        metadata: { some_meta: 123 }
      };

      mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'u_123' || where.email === 'test@cu.edu.ng') return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: BigInt(0) };
        if (where.id === 'u_operating') return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        return null;
      });

      mockPrisma.user.update.mockResolvedValue({ verifiedBalanceKobo: BigInt(50000) });
      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await service.handleWebhook(extraFieldsPayload, 'good-sig');
      expect(result).toEqual({ success: true });
    });

    it('charge.success: rejects invalid amount strings (NaN)', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: "invalid_amount", status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      await expect(service.handleWebhook(payload, 'good-sig')).rejects.toThrow(BadRequestException);
    });

    it('charge.success: rejects negative amounts', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: -500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      await expect(service.handleWebhook(payload, 'good-sig')).rejects.toThrow(BadRequestException);
    });
  });
});
