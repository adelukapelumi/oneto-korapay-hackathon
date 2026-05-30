import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard, type AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { UserThrottlerGuard } from "../common/user-throttler.guard";
import { RecoveryController } from "./recovery.controller";
import { RecoveryService } from "./recovery.service";

describe("RecoveryController", () => {
  let controller: RecoveryController;
  let reflector: Reflector;

  const mockRecoveryService = {
    createRecoveryRequest: jest.fn(),
    getLatestRecoveryStatus: jest.fn(),
    cancelRecoveryRequest: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecoveryController],
      providers: [{ provide: RecoveryService, useValue: mockRecoveryService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RecoveryController>(RecoveryController);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it("delegates create recovery request with authenticated user context", async () => {
    const req = { user: { sub: "u_123" } } as AuthenticatedRequest;
    const body = {
      requestedNewPublicKey:
        "ed25519:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      riskType: "LOST_DEVICE" as const,
      reason: "LOST_PHONE" as const,
    };
    mockRecoveryService.createRecoveryRequest.mockResolvedValue({ id: "kr_1" });

    await expect(controller.createRecoveryRequest(body, req)).resolves.toEqual({ id: "kr_1" });
    expect(mockRecoveryService.createRecoveryRequest).toHaveBeenCalledWith("u_123", body);
  });

  it("request route should have strict throttle", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.createRecoveryRequest);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.createRecoveryRequest);

    expect(limit).toBe(3);
    expect(ttl).toBe(300000);
  });

  it("status route should have throttle", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.getRecoveryStatus);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.getRecoveryStatus);

    expect(limit).toBe(30);
    expect(ttl).toBe(60000);
  });

  it("cancel route should have throttle", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.cancelRecoveryRequest);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.cancelRecoveryRequest);

    expect(limit).toBe(6);
    expect(ttl).toBe(60000);
  });

  it("all recovery routes should use JwtAuthGuard and UserThrottlerGuard", () => {
    const requestGuards = Reflect.getMetadata("__guards__", controller.createRecoveryRequest);
    const statusGuards = Reflect.getMetadata("__guards__", controller.getRecoveryStatus);
    const cancelGuards = Reflect.getMetadata("__guards__", controller.cancelRecoveryRequest);

    expect(requestGuards).toContain(JwtAuthGuard);
    expect(requestGuards).toContain(UserThrottlerGuard);
    expect(statusGuards).toContain(JwtAuthGuard);
    expect(statusGuards).toContain(UserThrottlerGuard);
    expect(cancelGuards).toContain(JwtAuthGuard);
    expect(cancelGuards).toContain(UserThrottlerGuard);
  });
});
