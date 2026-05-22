import { Test, TestingModule } from '@nestjs/testing';
import { ReconcileController } from './reconcile.controller';
import { ReconcileService } from './reconcile.service';
import { Reflector } from '@nestjs/core';
import { UserThrottlerGuard } from '../common/user-throttler.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('ReconcileController Rate Limits', () => {
  let controller: ReconcileController;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReconcileController],
      providers: [
        {
          provide: ReconcileService,
          useValue: { reconcile: jest.fn(), resolveOutgoingStatuses: jest.fn() },
        },
      ],
    })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(UserThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<ReconcileController>(ReconcileController);
    reflector = module.get<Reflector>(Reflector);
  });

  it('reconcile route should have correct @Throttle limits (20 req/min)', () => {
    // In @nestjs/throttler v5+, metadata keys are prefixed with throttler name
    // The default name is 'default'
    const limit = reflector.get('THROTTLER:LIMITdefault', controller.reconcile);
    const ttl = reflector.get('THROTTLER:TTLdefault', controller.reconcile);

    expect(limit).toBe(20);
    expect(ttl).toBe(60000);
  });

  it('reconcile route should use UserThrottlerGuard', () => {
    // __guards__ is the metadata key for @UseGuards
    const guards = Reflect.getMetadata('__guards__', controller.reconcile);
    expect(guards).toContain(UserThrottlerGuard);
  });

  it('status route should have correct @Throttle limits (30 req/min)', () => {
    const limit = reflector.get('THROTTLER:LIMITdefault', controller.status);
    const ttl = reflector.get('THROTTLER:TTLdefault', controller.status);

    expect(limit).toBe(30);
    expect(ttl).toBe(60000);
  });

  it('status route should use UserThrottlerGuard', () => {
    const guards = Reflect.getMetadata('__guards__', controller.status);
    expect(guards).toContain(UserThrottlerGuard);
  });
});
