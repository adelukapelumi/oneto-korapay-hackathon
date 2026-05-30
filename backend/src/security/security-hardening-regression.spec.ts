import { AdminController } from "../admin/admin.controller";
import { AuthController } from "../auth/auth.controller";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { KeysController } from "../auth/keys.controller";
import { MerchantAuthController } from "../auth/merchant-auth.controller";
import { UserThrottlerGuard } from "../common/user-throttler.guard";
import { CashoutController } from "../cashout/cashout.controller";
import { MeController } from "../me/me.controller";
import { MerchantsController } from "../merchants/merchants.controller";
import { RecoveryController } from "../recovery/recovery.controller";
import { TopupController } from "../topup/topup.controller";

function getThrottleLimit(method: object): number | undefined {
  return Reflect.getMetadata("THROTTLER:LIMITdefault", method) as
    | number
    | undefined;
}

function getThrottleTtl(method: object): number | undefined {
  return Reflect.getMetadata("THROTTLER:TTLdefault", method) as
    | number
    | undefined;
}

function getGuards(method: object): unknown[] {
  return (Reflect.getMetadata("__guards__", method) as unknown[]) ?? [];
}

describe("Security hardening regression lock-in", () => {
  it("locks public OTP throttle limits", () => {
    expect(getThrottleLimit(AuthController.prototype.requestOtp)).toBe(6);
    expect(getThrottleTtl(AuthController.prototype.requestOtp)).toBe(60000);

    expect(getThrottleLimit(AuthController.prototype.verifyOtp)).toBe(12);
    expect(getThrottleTtl(AuthController.prototype.verifyOtp)).toBe(60000);

    expect(getThrottleLimit(MerchantAuthController.prototype.requestMerchantOtp)).toBe(3);
    expect(getThrottleTtl(MerchantAuthController.prototype.requestMerchantOtp)).toBe(60000);

    expect(getThrottleLimit(MerchantAuthController.prototype.verifyMerchantOtp)).toBe(6);
    expect(getThrottleTtl(MerchantAuthController.prototype.verifyMerchantOtp)).toBe(60000);
  });

  it("locks key registration abuse controls", () => {
    expect(getThrottleLimit(KeysController.prototype.register)).toBe(5);
    expect(getThrottleTtl(KeysController.prototype.register)).toBe(60000);

    const guards = getGuards(KeysController.prototype.register);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(UserThrottlerGuard);
  });

  it("locks top-up and recovery endpoint throttles", () => {
    expect(getThrottleLimit(TopupController.prototype.initiate)).toBe(10);
    expect(getThrottleTtl(TopupController.prototype.initiate)).toBe(60000);

    expect(getThrottleLimit(RecoveryController.prototype.createRecoveryRequest)).toBe(3);
    expect(getThrottleTtl(RecoveryController.prototype.createRecoveryRequest)).toBe(300000);
  });

  it("locks admin mutation throttle envelope", () => {
    expect(getThrottleLimit(AdminController.prototype.createMerchant)).toBe(10);
    expect(getThrottleTtl(AdminController.prototype.createMerchant)).toBe(60000);

    expect(getThrottleLimit(AdminController.prototype.approveCashout)).toBe(30);
    expect(getThrottleTtl(AdminController.prototype.approveCashout)).toBe(60000);

    expect(getThrottleLimit(AdminController.prototype.approveRecoveryRequest)).toBe(10);
    expect(getThrottleTtl(AdminController.prototype.approveRecoveryRequest)).toBe(60000);
  });

  it("locks authenticated read endpoint throttles", () => {
    expect(getThrottleLimit(MeController.prototype.getMe)).toBe(60);
    expect(getThrottleTtl(MeController.prototype.getMe)).toBe(60000);

    expect(getThrottleLimit(MeController.prototype.getLedger)).toBe(30);
    expect(getThrottleTtl(MeController.prototype.getLedger)).toBe(60000);

    expect(getThrottleLimit(MerchantsController.prototype.list)).toBe(60);
    expect(getThrottleTtl(MerchantsController.prototype.list)).toBe(60000);

    expect(getThrottleLimit(CashoutController.prototype.getStatus)).toBe(30);
    expect(getThrottleTtl(CashoutController.prototype.getStatus)).toBe(60000);
  });
});
