import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, LedgerEntryType } from '@prisma/client';
import { MAX_USER_BALANCE_KOBO } from '@oneto/shared';
import { TopupService } from './topup.service';
import { KorapayService } from './korapay.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TopupService', () => {
  let service: TopupService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentTopup: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
    verifyTransaction: jest.fn(),
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
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
    );
  });

  function buildSuccessfulPayload(reference: string = 'top_123') {
    return {
      event: 'charge.success',
      data: {
        reference,
        amount: 500,
        status: 'success',
        customer: { email: 'test@cu.edu.ng' },
      },
    };
  }

  function buildPendingTopup(overrides?: Partial<{ status: string; amountKobo: bigint; userId: string }>) {
    return {
      userId: overrides?.userId ?? 'u_123',
      status: overrides?.status ?? 'PENDING',
      amountKobo: overrides?.amountKobo ?? BigInt(50_000),
    };
  }

  function mockHappyPathUsers(balanceKobo: bigint = BigInt(0)) {
    mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'u_123') {
        return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: balanceKobo };
      }
      if (where.id === 'u_operating') {
        return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
      }
      return null;
    });

    mockPrisma.user.update.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'u_123') {
        return { verifiedBalanceKobo: balanceKobo + BigInt(50_000) };
      }
      if (where.id === 'u_operating') {
        return { verifiedBalanceKobo: BigInt(-50_000) };
      }
      return {};
    });
  }

  describe('initiate', () => {
    it('creates a pending top-up record and returns the checkout URL', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });
      mockKorapay.initiateCheckout.mockResolvedValue({ paymentUrl: 'https://pay.korapay.com/checkout' });

      const result = await service.initiate('u_123', 50_000);

      expect(result.paymentUrl).toBe('https://pay.korapay.com/checkout');
      expect(result.reference).toMatch(/^top_[a-f0-9]{24}$/);
      expect(mockPrisma.paymentTopup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u_123',
            amountKobo: BigInt(50_000),
            status: 'PENDING',
          }),
        }),
      );
    });

    it('rejects amounts below the configured minimum', async () => {
      await expect(service.initiate('u_123', 9_999)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStatusForUser', () => {
    it('returns only the requesting user top-up', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: '50000',
      });
      expect(mockPrisma.paymentTopup.findFirst).toHaveBeenCalledWith({
        where: { reference: 'top_123', userId: 'u_123' },
        select: { reference: true, status: true, amountKobo: true },
      });
    });

    it("returns not found when the reference doesn't belong to the requester", async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue(null);

      await expect(service.getStatusForUser('u_other', 'top_123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleWebhook', () => {
    it('rejects invalid webhook signatures', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(false);

      await expect(service.handleWebhook({ data: {} }, 'bad-sig')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects malformed payloads', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);

      await expect(
        service.handleWebhook({ event: 'charge.success', data: { amount: 500, status: 'success' } }, 'good-sig'),
      ).rejects.toThrow(BadRequestException);
    });

    it('credits exactly once when charge.success is confirmed by Korapay verification', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
        currency: 'NGN',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockHappyPathUsers();

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockKorapay.verifyTransaction).toHaveBeenCalledWith('top_123');
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_123' },
          data: { verifiedBalanceKobo: { increment: BigInt(50_000) } },
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_operating' },
          data: { verifiedBalanceKobo: { decrement: BigInt(50_000) } },
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionId: 'top_123',
            userId: 'u_123',
            type: LedgerEntryType.CREDIT,
            amountKobo: BigInt(50_000),
          }),
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionId: 'top_123',
            userId: 'u_operating',
            type: LedgerEntryType.DEBIT,
            amountKobo: BigInt(50_000),
          }),
        }),
      );
    });

    it('does not credit when verification is still pending', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'processing',
        reference: 'top_123',
        amount: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            korapayResponse: expect.any(Object),
          }),
        }),
      );
      const updateData = mockPrisma.paymentTopup.update.mock.calls[0]?.[0]?.data as { status?: string };
      expect(updateData?.status).toBeUndefined();
    });

    it('does not credit when verification says the transaction failed', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'failed',
        reference: 'top_123',
        amount: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('fails closed on verified amount mismatch', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '600.00',
        amountPaid: '600.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'FAILED',
            korapayResponse: expect.objectContaining({
              internal_failure: 'amount_mismatch',
            }),
          }),
        }),
      );
    });

    it('refuses to credit when no pending top-up exists for the reference', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(null);

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does not double-credit when the reference is already marked successful', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup({ status: 'SUCCESS' }));

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('returns success idempotently when the transaction hits the unique constraint race path', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockHappyPathUsers();

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['transactionId', 'userId'] },
      });
      mockPrisma.$transaction.mockRejectedValue(p2002Error);

      await expect(service.handleWebhook(buildSuccessfulPayload(), 'good-sig')).resolves.toEqual({ success: true });
    });

    it('records failed webhooks without mutating balances', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(
        {
          event: 'charge.failed',
          data: {
            reference: 'top_123',
            amount: 500,
            status: 'failed',
            customer: { email: 'test@cu.edu.ng' },
          },
        },
        'good-sig',
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          update: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('marks the top-up failed when the balance cap would be exceeded', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'u_123') {
          return {
            id: 'u_123',
            email: 'test@cu.edu.ng',
            verifiedBalanceKobo: BigInt(MAX_USER_BALANCE_KOBO - 1_000),
          };
        }
        if (where.id === 'u_operating') {
          return { id: 'u_operating', verifiedBalanceKobo: BigInt(0) };
        }
        return null;
      });

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'FAILED',
            korapayResponse: expect.objectContaining({
              internal_failure: 'balance_cap_exceeded',
            }),
          }),
        }),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws 500 on internal transaction failures so real processing errors still retry', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockHappyPathUsers();
      mockPrisma.$transaction.mockRejectedValue(new Error('DB crash'));

      await expect(service.handleWebhook(buildSuccessfulPayload(), 'good-sig')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
