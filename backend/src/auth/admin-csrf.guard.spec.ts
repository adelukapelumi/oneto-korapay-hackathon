import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminCsrfGuard } from "./admin-csrf.guard";

describe("AdminCsrfGuard", () => {
  function makeContext(
    method: string,
    headers: Record<string, string | undefined>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it("allows safe GET requests without CSRF header", () => {
    const guard = new AdminCsrfGuard({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    expect(
      guard.canActivate(
        makeContext("GET", {
          origin: undefined,
        }),
      ),
    ).toBe(true);
  });

  it("rejects unsafe POST requests without CSRF header", () => {
    const guard = new AdminCsrfGuard({
      get: jest.fn().mockReturnValue("https://admin.getoneto.com"),
    } as unknown as ConfigService);

    expect(() =>
      guard.canActivate(
        makeContext("POST", {
          origin: "https://admin.getoneto.com",
          "x-oneto-admin-csrf": undefined,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("rejects unsafe POST requests from untrusted origin", () => {
    const guard = new AdminCsrfGuard({
      get: jest.fn().mockReturnValue("https://admin.getoneto.com"),
    } as unknown as ConfigService);

    expect(() =>
      guard.canActivate(
        makeContext("POST", {
          origin: "https://evil.example.com",
          "x-oneto-admin-csrf": "1",
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
