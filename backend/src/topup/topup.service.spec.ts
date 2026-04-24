import { Test, TestingModule } from '@nestjs/testing';
import { TopupService } from './topup.service';
import { KorapayService } from './korapay.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
  });

  afterEach(() => {
    jest.clearAllMocks();
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

    it('charge.success: creates PaymentTopup, increments user balance, returns success', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });
      
      // Mock the transaction execution
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });

      const result = await service.handleWebhook(payload, 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          reference: 'top_123',
          userId: 'u_123',
          amountKobo: BigInt(50000), // 500 * 100
          status: 'SUCCESS',
        }),
      }));
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u_123' },
        data: { verifiedBalanceKobo: { increment: 50000 } },
      }));
    });

    it('charge.success with duplicate reference: returns success idempotently WITHOUT double-crediting', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.success',
        data: { reference: 'top_123', amount: 500, status: 'success', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });
      
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

    it('charge.failed: creates FAILED PaymentTopup, no balance change', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      const payload = {
        event: 'charge.failed',
        data: { reference: 'top_fail', amount: 500, status: 'failed', customer: { email: 'test@cu.edu.ng' } },
      };
      
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });

      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
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
      const payload = { event: 'transfer.success', data: {} };
      
      const result = await service.handleWebhook(payload, 'good-sig');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.create).not.toHaveBeenCalled();
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
      expect(mockPrisma.paymentTopup.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
