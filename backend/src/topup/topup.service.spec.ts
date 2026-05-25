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
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
    );
  });

  function buildSuccessfulPayload(reference: string = 'top_123', amount: string | number = 500) {
    return {
      event: 'charge.success',
      data: {
        reference,
        amount,
        status: 'success',
        customer: { email: 'test@cu.edu.ng' },
      },
    };
  }

  function buildPendingTopup(
    overrides?: Partial<{ reference: string; status: string; amountKobo: bigint; userId: string }>,
  ) {
    return {
      reference: overrides?.reference ?? 'top_123',
      userId: overrides?.userId ?? 'u_123',
      status: overrides?.status ?? 'PENDING',
      amountKobo: overrides?.amountKobo ?? BigInt(50_000),
    };
  }

  function mockSuccessfulVerification(
    overrides?: Partial<{
      reference: string;
      status: string;
      amount: string;
      amountPaid: string;
      fee: string;
      transactionFee: string;
      processorFee: string;
      merchantBearsCost: boolean;
      currency: string;
    }>,
  ) {
    mockKorapay.verifyTransaction.mockResolvedValue({
      status: overrides?.status ?? 'success',
      reference: overrides?.reference ?? 'top_123',
      amount: overrides?.amount ?? '500.00',
      amountPaid: overrides?.amountPaid ?? '500.00',
      fee: overrides?.fee,
      transactionFee: overrides?.transactionFee,
      processorFee: overrides?.processorFee,
      merchantBearsCost: overrides?.merchantBearsCost,
      currency: overrides?.currency ?? 'NGN',
    });
  }

  function mockHappyPathUsers(balanceKobo: bigint = BigInt(0), creditAmountKobo: bigint = BigInt(50_000)) {
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
        return { verifiedBalanceKobo: balanceKobo + creditAmountKobo };
      }
      if (where.id === 'u_operating') {
        return { verifiedBalanceKobo: -creditAmountKobo };
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
            creditedAmountKobo: BigInt(50_000),
            feeBearer: 'STUDENT',
            status: 'PENDING',
          }),
        }),
      );
      const initiateCallOrder = mockKorapay.initiateCheckout.mock.invocationCallOrder[0];
      const createCallOrder = mockPrisma.paymentTopup.create.mock.invocationCallOrder[0];

      if (initiateCallOrder === undefined || createCallOrder === undefined) {
        throw new Error('Expected initiateCheckout and paymentTopup.create to both be called');
      }

      expect(initiateCallOrder).toBeLessThan(createCallOrder);
    });

    it('rejects amounts below the configured minimum', async () => {
      await expect(service.initiate('u_123', 9_999)).rejects.toThrow(BadRequestException);
    });

    it('does not create a pending top-up when Korapay initialization fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u_123', email: 'test@cu.edu.ng' });
      mockKorapay.initiateCheckout.mockRejectedValue(new InternalServerErrorException('gateway error'));

      await expect(service.initiate('u_123', 50_000)).rejects.toThrow(InternalServerErrorException);
      expect(mockPrisma.paymentTopup.create).not.toHaveBeenCalled();
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
      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
    });

    it('verifies and credits a pending top-up when Korapay confirms success', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
        currency: 'NGN',
      });
      mockHappyPathUsers();

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '50000',
      });

      expect(mockKorapay.verifyTransaction).toHaveBeenCalledWith('top_123');
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

    it('credits exactly the requested ₦1,000 when the student pays Korapay fees on top', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(100_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(
        buildPendingTopup({ amountKobo: BigInt(100_000) }),
      );
      mockSuccessfulVerification({
        amount: '1000.00',
        amountPaid: '1014.00',
        fee: '14.00',
        merchantBearsCost: false,
      });
      mockHappyPathUsers(BigInt(0), BigInt(100_000));

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '100000',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_123' },
          data: { verifiedBalanceKobo: { increment: BigInt(100_000) } },
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_operating' },
          data: { verifiedBalanceKobo: { decrement: BigInt(100_000) } },
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: LedgerEntryType.CREDIT,
            amountKobo: BigInt(100_000),
          }),
        }),
      );
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'SUCCESS',
            creditedAmountKobo: BigInt(100_000),
            feeBearer: 'STUDENT',
            processorFeeKobo: BigInt(1_400),
            grossPaidKobo: BigInt(101_400),
            korapayResponse: expect.objectContaining({
              verification: expect.objectContaining({
                amount: '1000.00',
                amountPaid: '1014.00',
                fee: '14.00',
                merchantBearsCost: false,
              }),
              accounting: expect.objectContaining({
                creditAmountKobo: '100000',
                grossPaidKobo: '101400',
                processorFeeKobo: '1400',
                feeBearer: 'STUDENT',
              }),
            }),
          }),
        }),
      );
    });

    it('fails closed when Korapay charge amount is ₦900 for a ₦1,000 pending top-up even if gross paid is higher', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(100_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(
        buildPendingTopup({ amountKobo: BigInt(100_000) }),
      );
      mockSuccessfulVerification({
        amount: '900.00',
        amountPaid: '1014.00',
        fee: '14.00',
        merchantBearsCost: false,
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'FAILED',
        amountKobo: '100000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'FAILED',
            creditedAmountKobo: BigInt(100_000),
            processorFeeKobo: BigInt(1_400),
            grossPaidKobo: BigInt(101_400),
            korapayResponse: expect.objectContaining({
              internal_failure: 'amount_mismatch',
            }),
          }),
        }),
      );
    });

    it('leaves the top-up pending when Korapay verification is still pending', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'processing',
        reference: 'top_123',
        amount: '500.00',
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: '50000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            korapayResponse: expect.objectContaining({
              source: 'status_poll',
            }),
          }),
        }),
      );
    });

    it('keeps the top-up pending when Korapay verification is not_found', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'not_found',
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: '50000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            korapayResponse: expect.objectContaining({
              verification: expect.objectContaining({
                status: 'not_found',
              }),
            }),
          }),
        }),
      );
    });

    it('marks the top-up failed when Korapay verification says failed', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'failed',
        reference: 'top_123',
        amount: '500.00',
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'FAILED',
        amountKobo: '50000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('marks the top-up failed when Korapay verification says failure', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'failure',
        reference: 'top_123',
        amount: '500.00',
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'FAILED',
        amountKobo: '50000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('finalizes a pending top-up when Korapay returns successful', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'successful',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
        currency: 'NGN',
      });
      mockHappyPathUsers();

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '50000',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
    });

    it('fails closed when verification amount does not match the pending top-up', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '600.00',
        amountPaid: '600.00',
        currency: 'NGN',
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'FAILED',
        amountKobo: '50000',
      });

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

    it('credits exactly 10000 kobo for live student-fee verification payloads', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(10_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(
        buildPendingTopup({ amountKobo: BigInt(10_000) }),
      );
      mockSuccessfulVerification({
        amount: '101.61',
        amountPaid: '101.61',
        fee: '1.61',
        merchantBearsCost: false,
      });
      mockHappyPathUsers(BigInt(0), BigInt(10_000));

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '10000',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_123' },
          data: { verifiedBalanceKobo: { increment: BigInt(10_000) } },
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: LedgerEntryType.CREDIT,
            amountKobo: BigInt(10_000),
          }),
        }),
      );
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'SUCCESS',
            creditedAmountKobo: BigInt(10_000),
            feeBearer: 'STUDENT',
            processorFeeKobo: BigInt(161),
            grossPaidKobo: BigInt(10_161),
          }),
        }),
      );
    });

    it('fails closed when amount_paid and fee do not resolve to the pending credit amount', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(10_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(
        buildPendingTopup({ amountKobo: BigInt(10_000) }),
      );
      mockSuccessfulVerification({
        amount: '100.00',
        amountPaid: '50.00',
        fee: '1.61',
        merchantBearsCost: false,
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'FAILED',
        amountKobo: '10000',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
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

    it('succeeds when amount_paid and explicit fee reconcile to pending credit', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(10_000),
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(
        buildPendingTopup({ amountKobo: BigInt(10_000) }),
      );
      mockSuccessfulVerification({
        amount: '100.00',
        amountPaid: '101.61',
        fee: '1.61',
        merchantBearsCost: false,
      });
      mockHappyPathUsers(BigInt(0), BigInt(10_000));

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '10000',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u_123' },
          data: { verifiedBalanceKobo: { increment: BigInt(10_000) } },
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: LedgerEntryType.CREDIT,
            amountKobo: BigInt(10_000),
          }),
        }),
      );
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'SUCCESS',
            creditedAmountKobo: BigInt(10_000),
            feeBearer: 'STUDENT',
            processorFeeKobo: BigInt(161),
            grossPaidKobo: BigInt(10_161),
          }),
        }),
      );
    });

    it('does not double-credit when status is already successful', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: BigInt(50_000),
      });

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '50000',
      });

      expect(mockKorapay.verifyTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('stays idempotent when status polling races with another finalizer', async () => {
      mockPrisma.paymentTopup.findFirst.mockResolvedValue({
        reference: 'top_123',
        status: 'PENDING',
        amountKobo: BigInt(50_000),
      });
      mockPrisma.paymentTopup.findUnique
        .mockResolvedValueOnce(buildPendingTopup())
        .mockResolvedValueOnce(buildPendingTopup({ status: 'SUCCESS' }));
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
        currency: 'NGN',
      });
      mockHappyPathUsers();

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['transactionId', 'userId'] },
      });
      mockPrisma.$transaction.mockRejectedValue(p2002Error);

      await expect(service.getStatusForUser('u_123', 'top_123')).resolves.toEqual({
        reference: 'top_123',
        status: 'SUCCESS',
        amountKobo: '50000',
      });
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

    it('calls active Korapay verification before crediting a valid charge.success webhook', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
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

    it('keeps a signed success webhook pending when active verification is not successful yet', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'not_found',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockKorapay.verifyTransaction).toHaveBeenCalledWith('top_123');
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            korapayResponse: expect.objectContaining({
              source: 'webhook',
              verification: expect.objectContaining({
                status: 'not_found',
              }),
            }),
          }),
        }),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('does not credit when a signed success webhook active verification is failed', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'failed',
        reference: 'top_123',
        amount: '500.00',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('fails closed when signed success webhook active verification amount mismatches', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockResolvedValue({
        status: 'success',
        reference: 'top_123',
        amount: '600.00',
        amountPaid: '600.00',
        currency: 'NGN',
      });
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'FAILED',
            korapayResponse: expect.objectContaining({
              source: 'webhook',
              internal_failure: 'amount_mismatch',
            }),
          }),
        }),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('keeps the top-up pending when signed success webhook active verification throws', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockKorapay.verifyTransaction.mockRejectedValue(new InternalServerErrorException('gateway timeout'));
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());

      const result = await service.handleWebhook(buildSuccessfulPayload(), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            korapayResponse: expect.objectContaining({
              source: 'webhook',
              verification: expect.objectContaining({
                status: 'verification_error',
              }),
            }),
          }),
        }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('uses payment_reference when reference is absent', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
      mockHappyPathUsers();

      const result = await service.handleWebhook(
        {
          event: 'charge.success',
          data: {
            payment_reference: 'top_123',
            amount: 500,
            status: 'success',
            customer: { email: 'test@cu.edu.ng' },
          },
        },
        'good-sig',
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
        }),
      );
      expect(mockKorapay.verifyTransaction).toHaveBeenCalledWith('top_123');
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('does not fall back to payment_reference when reference is present', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(null);

      const result = await service.handleWebhook(
        {
          event: 'charge.success',
          data: {
            reference: 'top_primary',
            payment_reference: 'top_fallback',
            amount: 500,
            status: 'success',
            customer: { email: 'test@cu.edu.ng' },
          },
        },
        'good-sig',
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.paymentTopup.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_primary' },
        }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does not double-credit when the same valid webhook arrives twice', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      let topup = buildPendingTopup();
      let userBalanceKobo = BigInt(0);
      let operatingBalanceKobo = BigInt(0);
      mockSuccessfulVerification();

      mockPrisma.paymentTopup.findUnique.mockImplementation(async () => topup);
      mockPrisma.paymentTopup.update.mockImplementation(
        async ({ data }: { data: { status?: string } }) => {
          topup = {
            ...topup,
            status: data.status ?? topup.status,
          };
          return topup;
        },
      );
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'u_123') {
          return { id: 'u_123', email: 'test@cu.edu.ng', verifiedBalanceKobo: userBalanceKobo };
        }
        if (where.id === 'u_operating') {
          return { id: 'u_operating', verifiedBalanceKobo: operatingBalanceKobo };
        }
        return null;
      });
      mockPrisma.user.update.mockImplementation(
        async ({ where, data }: {
          where: { id: string };
          data: { verifiedBalanceKobo: { increment?: bigint; decrement?: bigint } };
        }) => {
          const delta =
            data.verifiedBalanceKobo.increment ??
            (data.verifiedBalanceKobo.decrement !== undefined
              ? -data.verifiedBalanceKobo.decrement
              : BigInt(0));

          if (where.id === 'u_123') {
            userBalanceKobo += delta;
            return { verifiedBalanceKobo: userBalanceKobo };
          }
          if (where.id === 'u_operating') {
            operatingBalanceKobo += delta;
            return { verifiedBalanceKobo: operatingBalanceKobo };
          }
          return {};
        },
      );

      await expect(service.handleWebhook(buildSuccessfulPayload(), 'good-sig')).resolves.toEqual({ success: true });
      await expect(service.handleWebhook(buildSuccessfulPayload(), 'good-sig')).resolves.toEqual({ success: true });

      expect(userBalanceKobo).toBe(BigInt(50_000));
      expect(operatingBalanceKobo).toBe(BigInt(-50_000));
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
    });

    it('does not trust webhook amount semantics and still requires active verification', async () => {
      mockKorapay.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
      mockHappyPathUsers();

      const result = await service.handleWebhook(buildSuccessfulPayload('top_123', 600), 'good-sig');

      expect(result).toEqual({ success: true });
      expect(mockKorapay.verifyTransaction).toHaveBeenCalledWith('top_123');
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.paymentTopup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'top_123' },
          data: expect.objectContaining({
            status: 'SUCCESS',
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
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
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
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
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
      mockPrisma.paymentTopup.findUnique.mockResolvedValue(buildPendingTopup());
      mockSuccessfulVerification();
      mockHappyPathUsers();
      mockPrisma.$transaction.mockRejectedValue(new Error('DB crash'));

      await expect(service.handleWebhook(buildSuccessfulPayload(), 'good-sig')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
