import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';

describe('TopupController', () => {
  let controller: TopupController;
  let reflector: Reflector;

  const mockTopupService = {
    initiate: jest.fn(),
    getStatusForUser: jest.fn(),
    handleWebhook: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TopupController],
      providers: [{ provide: TopupService, useValue: mockTopupService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TopupController>(TopupController);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it('delegates status lookup to the service using the authenticated user', async () => {
    const req = { user: { sub: 'u_123' } } as unknown as AuthenticatedRequest;
    mockTopupService.getStatusForUser.mockResolvedValue({
      reference: 'top_123',
      status: 'PENDING',
      amountKobo: '50000',
    });

    await expect(controller.getStatus(req, 'top_123')).resolves.toEqual({
      reference: 'top_123',
      status: 'PENDING',
      amountKobo: '50000',
    });
    expect(mockTopupService.getStatusForUser).toHaveBeenCalledWith('u_123', 'top_123');
  });

  it('status route should have the configured throttle', () => {
    const limit = reflector.get('THROTTLER:LIMITdefault', controller.getStatus);
    const ttl = reflector.get('THROTTLER:TTLdefault', controller.getStatus);

    expect(limit).toBe(30);
    expect(ttl).toBe(60000);
  });

  it('status route should use JwtAuthGuard and UserThrottlerGuard', () => {
    const guards = Reflect.getMetadata('__guards__', controller.getStatus);

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(UserThrottlerGuard);
  });
});
