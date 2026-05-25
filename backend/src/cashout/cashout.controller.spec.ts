import { Test, TestingModule } from '@nestjs/testing';
import { CashoutController } from './cashout.controller';
import { CashoutService } from './cashout.service';
import { JwtWrapperService } from '../auth/jwt.service';
import { CashoutStatus, KorapayPayoutFeeBearer } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { MIN_CASHOUT_GROSS_KOBO, MIN_KORAPAY_TRANSFER_KOBO } from '@oneto/shared';

describe('CashoutController', () => {
  let controller: CashoutController;
  let service: CashoutService;
  let reflector: Reflector;

  const mockService = {
    requestCashout: jest.fn(),
    getRecentCashouts: jest.fn(),
    approveCashout: jest.fn(),
    handlePayoutWebhook: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashoutController],
      providers: [
        { provide: CashoutService, useValue: mockService },
        { provide: JwtWrapperService, useValue: mockJwtService },
      ],
    })
    .overrideGuard(UserThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<CashoutController>(CashoutController);
    service = module.get<CashoutService>(CashoutService);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it('1. MERCHANT can request cashout', async () => {
    const req = { user: { sub: 'u_merchant', role: 'MERCHANT' } } as any;
    mockService.requestCashout.mockResolvedValue({
      id: 'c_1',
      amountKobo: BigInt(5000),
      grossAmountKobo: BigInt(5000),
      onetoFeeBps: 250,
      onetoFeeKobo: BigInt(125),
      korapayPayoutFeeKobo: null,
      korapayPayoutFeeBearer: KorapayPayoutFeeBearer.UNKNOWN,
      korapayPayoutFeeDeductedFromRecipient: null,
      netPayoutKobo: null,
      korapayTransferAmountKobo: null,
      status: CashoutStatus.PENDING,
      requestedAt: new Date(),
    });

    const result = await controller.requestCashout(req);
    expect(result.cashout.id).toBe('c_1');
    expect(result.cashout.grossAmountKobo).toBe('5000');
    expect(result.cashout.onetoFeeBps).toBe(250);
    expect(result.cashout.onetoFeeKobo).toBe('125');
    expect(result.cashout.korapayPayoutFeeKobo).toBeNull();
    expect(result.cashout.korapayPayoutFeeBearer).toBe('UNKNOWN');
    expect(result.cashout.korapayPayoutFeeDeductedFromRecipient).toBeNull();
    expect(result.cashout.netPayoutKobo).toBeNull();
    expect(result.minimumCashoutGrossKobo).toBe(MIN_CASHOUT_GROSS_KOBO.toString());
    expect(result.minimumKorapayTransferKobo).toBe(MIN_KORAPAY_TRANSFER_KOBO.toString());
    expect(service.requestCashout).toHaveBeenCalledWith('u_merchant');
  });

  it('2. MERCHANT can get status', async () => {
    const req = { user: { sub: 'u_merchant', role: 'MERCHANT' } } as any;
    mockService.getRecentCashouts.mockResolvedValue([
      {
        id: 'c_1',
        amountKobo: BigInt(5000),
        grossAmountKobo: BigInt(5000),
        onetoFeeBps: 250,
        onetoFeeKobo: BigInt(125),
        korapayPayoutFeeKobo: BigInt(25),
        korapayPayoutFeeBearer: KorapayPayoutFeeBearer.ONETO,
        korapayPayoutFeeDeductedFromRecipient: false,
        netPayoutKobo: BigInt(4875),
        korapayTransferAmountKobo: BigInt(4875),
        status: CashoutStatus.COMPLETED,
        requestedAt: new Date(),
      },
    ]);

    const result: any = await controller.getStatus(req);
    expect(result.cashouts).toHaveLength(1);
    expect(result.cashouts[0].amountKobo).toBe('5000');
    expect(result.cashouts[0].grossAmountKobo).toBe('5000');
    expect(result.cashouts[0].korapayPayoutFeeKobo).toBe('25');
    expect(result.cashouts[0].korapayPayoutFeeBearer).toBe('ONETO');
    expect(result.cashouts[0].korapayPayoutFeeDeductedFromRecipient).toBe(false);
    expect(result.cashouts[0].netPayoutKobo).toBe('4875');
    expect(result.minimumCashoutGrossKobo).toBe(MIN_CASHOUT_GROSS_KOBO.toString());
    expect(result.minimumKorapayTransferKobo).toBe(MIN_KORAPAY_TRANSFER_KOBO.toString());
  });

  it('3. ADMIN can approve cashout', async () => {
    const req = { user: { sub: 'u_admin', role: 'ADMIN' } } as any;
    mockService.approveCashout.mockResolvedValue({ success: true });

    const result = await controller.approveCashout('c_1', req);
    expect(result.success).toBe(true);
    expect(service.approveCashout).toHaveBeenCalledWith('c_1', 'u_admin');
  });

  it('4. Webhook accepts signed payload', async () => {
    const payload = { event: 'transfer.success', data: { reference: 'ref' } };
    mockService.handlePayoutWebhook.mockResolvedValue({ success: true });

    const result = await controller.handleWebhook(payload, 'sig');
    expect(result.success).toBe(true);
    expect(service.handlePayoutWebhook).toHaveBeenCalledWith(payload, 'sig');
  });

  describe('Rate Limiting Metadata', () => {
    it('requestCashout should have correct @Throttle limits (5 req/min)', () => {
      const limit = reflector.get('THROTTLER:LIMITdefault', controller.requestCashout);
      const ttl = reflector.get('THROTTLER:TTLdefault', controller.requestCashout);
      expect(limit).toBe(5);
      expect(ttl).toBe(60000);
    });

    it('requestCashout should use UserThrottlerGuard', () => {
      const guards = Reflect.getMetadata('__guards__', controller.requestCashout);
      expect(guards).toContain(UserThrottlerGuard);
    });

    it('approveCashout should have correct @Throttle limits (30 req/min)', () => {
      const limit = reflector.get('THROTTLER:LIMITdefault', controller.approveCashout);
      const ttl = reflector.get('THROTTLER:TTLdefault', controller.approveCashout);
      expect(limit).toBe(30);
      expect(ttl).toBe(60000);
    });

    it('approveCashout should use UserThrottlerGuard', () => {
      const guards = Reflect.getMetadata('__guards__', controller.approveCashout);
      expect(guards).toContain(UserThrottlerGuard);
    });
  });
});
