import { Test, TestingModule } from '@nestjs/testing';
import { CashoutService } from '../cashout/cashout.service';
import { TopupService } from '../topup/topup.service';
import { KorapayWebhookController } from './korapay-webhook.controller';

describe('KorapayWebhookController', () => {
  let controller: KorapayWebhookController;

  const mockTopupService = {
    handleWebhook: jest.fn(),
  };

  const mockCashoutService = {
    handlePayoutWebhook: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KorapayWebhookController],
      providers: [
        { provide: TopupService, useValue: mockTopupService },
        { provide: CashoutService, useValue: mockCashoutService },
      ],
    }).compile();

    controller = module.get<KorapayWebhookController>(KorapayWebhookController);
    jest.clearAllMocks();
  });

  it('routes charge.success to TopupService.handleWebhook', async () => {
    const payload = { event: 'charge.success', data: { reference: 'ref_1' } };
    mockTopupService.handleWebhook.mockResolvedValue({ success: true });

    const result = await controller.handleUnifiedWebhook(payload, 'sig_1');

    expect(result).toEqual({ success: true });
    expect(mockTopupService.handleWebhook).toHaveBeenCalledWith(payload, 'sig_1');
    expect(mockCashoutService.handlePayoutWebhook).not.toHaveBeenCalled();
  });

  it('routes charge.failed to TopupService.handleWebhook', async () => {
    const payload = { event: 'charge.failed', data: { reference: 'ref_2' } };
    mockTopupService.handleWebhook.mockResolvedValue({ success: true });

    await controller.handleUnifiedWebhook(payload, 'sig_2');

    expect(mockTopupService.handleWebhook).toHaveBeenCalledWith(payload, 'sig_2');
    expect(mockCashoutService.handlePayoutWebhook).not.toHaveBeenCalled();
  });

  it('routes transfer.success to CashoutService.handlePayoutWebhook', async () => {
    const payload = { event: 'transfer.success', data: { reference: 'ref_3' } };
    mockCashoutService.handlePayoutWebhook.mockResolvedValue({ success: true });

    await controller.handleUnifiedWebhook(payload, 'sig_3');

    expect(mockCashoutService.handlePayoutWebhook).toHaveBeenCalledWith(payload, 'sig_3');
    expect(mockTopupService.handleWebhook).not.toHaveBeenCalled();
  });

  it('routes transfer.failed to CashoutService.handlePayoutWebhook', async () => {
    const payload = { event: 'transfer.failed', data: { reference: 'ref_4' } };
    mockCashoutService.handlePayoutWebhook.mockResolvedValue({ success: true });

    await controller.handleUnifiedWebhook(payload, 'sig_4');

    expect(mockCashoutService.handlePayoutWebhook).toHaveBeenCalledWith(payload, 'sig_4');
    expect(mockTopupService.handleWebhook).not.toHaveBeenCalled();
  });

  it('returns success for unknown event and calls neither service', async () => {
    const payload = { event: 'charge.pending', data: { reference: 'ref_5' } };

    const result = await controller.handleUnifiedWebhook(payload, 'sig_5');

    expect(result).toEqual({ success: true });
    expect(mockTopupService.handleWebhook).not.toHaveBeenCalled();
    expect(mockCashoutService.handlePayoutWebhook).not.toHaveBeenCalled();
  });

  it('returns success for malformed payload and calls neither service', async () => {
    const result = await controller.handleUnifiedWebhook('not-an-object', 'sig_6');

    expect(result).toEqual({ success: true });
    expect(mockTopupService.handleWebhook).not.toHaveBeenCalled();
    expect(mockCashoutService.handlePayoutWebhook).not.toHaveBeenCalled();
  });
});
