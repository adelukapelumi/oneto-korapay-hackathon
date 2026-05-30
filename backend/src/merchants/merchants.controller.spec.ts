import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UserThrottlerGuard } from "../common/user-throttler.guard";
import { MerchantsController } from "./merchants.controller";
import { MerchantsService } from "./merchants.service";

describe("MerchantsController", () => {
  let controller: MerchantsController;
  let reflector: Reflector;

  const mockMerchantsService = {
    listActiveApprovedMerchants: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [{ provide: MerchantsService, useValue: mockMerchantsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MerchantsController>(MerchantsController);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it("delegates merchant list fetch", async () => {
    mockMerchantsService.listActiveApprovedMerchants.mockResolvedValue([
      { id: "u_merchant", label: "Campus Cafe" },
    ]);

    await expect(controller.list()).resolves.toEqual({
      merchants: [{ id: "u_merchant", label: "Campus Cafe" }],
    });
    expect(mockMerchantsService.listActiveApprovedMerchants).toHaveBeenCalledTimes(1);
  });

  it("applies throttle metadata", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.list);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.list);
    expect(limit).toBe(60);
    expect(ttl).toBe(60000);
  });

  it("uses JwtAuthGuard and UserThrottlerGuard", () => {
    const guards = Reflect.getMetadata("__guards__", controller.list);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(UserThrottlerGuard);
  });
});
