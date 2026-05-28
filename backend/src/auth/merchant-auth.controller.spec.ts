import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { MerchantAuthController } from "./merchant-auth.controller";
import { MerchantAuthService } from "./merchant-auth.service";

describe("MerchantAuthController", () => {
  let controller: MerchantAuthController;
  let service: jest.Mocked<MerchantAuthService>;
  let reflector: Reflector;

  const mockMerchantAuthService = {
    requestMerchantOtp: jest.fn(),
    verifyMerchantOtp: jest.fn(),
  } as unknown as jest.Mocked<MerchantAuthService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MerchantAuthController],
      providers: [{ provide: MerchantAuthService, useValue: mockMerchantAuthService }],
    }).compile();

    controller = module.get<MerchantAuthController>(MerchantAuthController);
    service = module.get(MerchantAuthService);
    reflector = module.get<Reflector>(Reflector);
  });

  it("delegates merchant OTP request and returns enumeration-safe success", async () => {
    service.requestMerchantOtp.mockResolvedValue(undefined);

    const result = await controller.requestMerchantOtp({
      email: "merchant@getoneto.com",
      businessName: "Campus Cafe",
      cashoutBankName: "Wema Bank",
      cashoutBankCode: "035",
      cashoutAccountNumber: "1234567890",
      cashoutAccountName: "Campus Cafe Ltd",
    });

    expect(service.requestMerchantOtp).toHaveBeenCalledWith(
      "merchant@getoneto.com",
      expect.objectContaining({
        businessName: "Campus Cafe",
      }),
    );
    expect(result).toEqual({
      success: true,
      message: "OTP sent if the email is valid",
    });
  });

  it("delegates merchant OTP verify and returns access token", async () => {
    service.verifyMerchantOtp.mockResolvedValue({ accessToken: "merchant.jwt" });

    const result = await controller.verifyMerchantOtp({
      email: "merchant@getoneto.com",
      code: "123456",
    });

    expect(service.verifyMerchantOtp).toHaveBeenCalledWith(
      "merchant@getoneto.com",
      "123456",
    );
    expect(result).toEqual({ success: true, accessToken: "merchant.jwt" });
  });

  it("applies strict throttle to public /auth/merchant/otp/request", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.requestMerchantOtp);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.requestMerchantOtp);

    expect(limit).toBe(3);
    expect(ttl).toBe(60000);
  });

  it("applies strict throttle to public /auth/merchant/otp/verify", () => {
    const limit = reflector.get("THROTTLER:LIMITdefault", controller.verifyMerchantOtp);
    const ttl = reflector.get("THROTTLER:TTLdefault", controller.verifyMerchantOtp);

    expect(limit).toBe(6);
    expect(ttl).toBe(60000);
  });
});
