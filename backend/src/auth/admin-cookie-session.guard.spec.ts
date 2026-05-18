import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { AdminCookieSessionGuard } from "./admin-cookie-session.guard";

describe("AdminCookieSessionGuard", () => {
  const guard = new AdminCookieSessionGuard();

  function makeContext(authTokenSource?: "cookie" | "bearer"): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ authTokenSource }),
      }),
    } as unknown as ExecutionContext;
  }

  it("rejects bearer-only admin auth", () => {
    expect(() => guard.canActivate(makeContext("bearer"))).toThrow(
      UnauthorizedException,
    );
  });

  it("accepts cookie-based admin auth", () => {
    expect(guard.canActivate(makeContext("cookie"))).toBe(true);
  });
});
