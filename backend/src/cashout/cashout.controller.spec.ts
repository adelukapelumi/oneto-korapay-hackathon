import { Test, TestingModule } from '@nestjs/testing';
import { CashoutController } from './cashout.controller';
import { CashoutService } from './cashout.service';
import { JwtWrapperService } from '../auth/jwt.service';
import { CashoutStatus } from '@prisma/client';

describe('CashoutController', () => {
  let controller: CashoutController;
  let service: CashoutService;

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
    }).compile();

    controller = module.get<CashoutController>(CashoutController);
    service = module.get<CashoutService>(CashoutService);
    jest.clearAllMocks();
  });

  it('1. MERCHANT can request cashout', async () => {
    const req = { user: { sub: 'u_merchant', role: 'MERCHANT' } };
    mockService.requestCashout.mockResolvedValue({
      id: 'c_1',
      amountKobo: BigInt(5000),
      status: CashoutStatus.PENDING,
      requestedAt: new Date(),
    });

    const result = await controller.requestCashout(req);
    expect(result.cashout.id).toBe('c_1');
    expect(service.requestCashout).toHaveBeenCalledWith('u_merchant');
  });

  it('2. MERCHANT can get status', async () => {
    const req = { user: { sub: 'u_merchant', role: 'MERCHANT' } };
    mockService.getRecentCashouts.mockResolvedValue([
      { id: 'c_1', amountKobo: BigInt(5000), status: CashoutStatus.COMPLETED },
    ]);

    const result: any = await controller.getStatus(req);
    expect(result.cashouts).toHaveLength(1);
    expect(result.cashouts[0].amountKobo).toBe('5000');
  });

  it('3. ADMIN can approve cashout', async () => {
    const req = { user: { sub: 'u_admin', role: 'ADMIN' } };
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
});
