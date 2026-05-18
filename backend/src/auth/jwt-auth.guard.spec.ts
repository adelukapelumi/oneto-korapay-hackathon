import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session.constants";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtWrapperService } from "./jwt.service";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  const mockJwtService = {
    verifyToken: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(mockJwtService as unknown as JwtWrapperService);
  });

  function makeContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it("accepts valid token from admin cookie", () => {
    const request = {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=cookie.jwt`,
      },
    };
    mockJwtService.verifyToken.mockReturnValue({
      sub: "u_admin",
      email: "admin@getoneto.com",
      role: "ADMIN",
      pubKeyRegistered: false,
    });

    const allowed = guard.canActivate(makeContext(request));

    expect(allowed).toBe(true);
    expect(mockJwtService.verifyToken).toHaveBeenCalledWith("cookie.jwt");
    expect(request).toMatchObject({
      authTokenSource: "cookie",
      user: {
        sub: "u_admin",
        role: "ADMIN",
      },
    });
  });

  it("falls back to Bearer token when cookie is not present", () => {
    const request = {
      headers: {
        authorization: "Bearer bearer.jwt",
      },
    };
    mockJwtService.verifyToken.mockReturnValue({
      sub: "u_user",
      email: "user@getoneto.com",
      role: "STUDENT",
      pubKeyRegistered: false,
    });

    const allowed = guard.canActivate(makeContext(request));

    expect(allowed).toBe(true);
    expect(mockJwtService.verifyToken).toHaveBeenCalledWith("bearer.jwt");
    expect(request).toMatchObject({ authTokenSource: "bearer" });
  });

  it("rejects missing auth token", () => {
    const request = { headers: {} };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      UnauthorizedException,
    );
  });
});
