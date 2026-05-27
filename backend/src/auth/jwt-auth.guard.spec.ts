import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session.constants";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { JwtWrapperService } from "./jwt.service";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  const mockJwtService = {
    verifyToken: jest.fn(),
  };
  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(
      mockJwtService as unknown as JwtWrapperService,
      mockPrismaService as unknown as PrismaService,
    );
  });

  function makeContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it("accepts valid token from admin cookie", async () => {
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
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: "u_admin",
      email: "admin@getoneto.com",
      role: "ADMIN",
      status: "ACTIVE",
      publicKey: null,
    });

    const allowed = await guard.canActivate(makeContext(request));

    expect(allowed).toBe(true);
    expect(mockJwtService.verifyToken).toHaveBeenCalledWith("cookie.jwt");
    expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u_admin" },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        publicKey: true,
      },
    });
    expect(request).toMatchObject({
      authTokenSource: "cookie",
      user: {
        sub: "u_admin",
        role: "ADMIN",
      },
    });
  });

  it("falls back to Bearer token when cookie is not present", async () => {
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
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: "u_user",
      email: "user@getoneto.com",
      role: "STUDENT",
      status: "ACTIVE",
      publicKey: "ed25519:" + "a".repeat(64),
    });

    const allowed = await guard.canActivate(makeContext(request));

    expect(allowed).toBe(true);
    expect(mockJwtService.verifyToken).toHaveBeenCalledWith("bearer.jwt");
    expect(request).toMatchObject({
      authTokenSource: "bearer",
      user: {
        role: "STUDENT",
        pubKeyRegistered: true,
      },
    });
  });

  it("rejects missing auth token", async () => {
    const request = { headers: {} };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("uses current DB role instead of stale token role", async () => {
    const request = {
      headers: {
        authorization: "Bearer stale-role.jwt",
      },
    };
    mockJwtService.verifyToken.mockReturnValue({
      sub: "u_user",
      email: "user@getoneto.com",
      role: "ADMIN",
      pubKeyRegistered: true,
    });
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: "u_user",
      email: "user@getoneto.com",
      role: "STUDENT",
      status: "ACTIVE",
      publicKey: null,
    });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      user: {
        sub: "u_user",
        role: "STUDENT",
      },
    });
  });

  it("rejects frozen or flagged users even with a valid token", async () => {
    const request = {
      headers: {
        authorization: "Bearer frozen.jwt",
      },
    };
    mockJwtService.verifyToken.mockReturnValue({
      sub: "u_user",
      email: "user@getoneto.com",
      role: "STUDENT",
      pubKeyRegistered: false,
    });
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: "u_user",
      email: "user@getoneto.com",
      role: "STUDENT",
      status: "FROZEN",
      publicKey: null,
    });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      "Account is not active",
    );
  });

  it("rejects token for users that no longer exist", async () => {
    const request = {
      headers: {
        authorization: "Bearer deleted-user.jwt",
      },
    };
    mockJwtService.verifyToken.mockReturnValue({
      sub: "u_deleted",
      email: "deleted@getoneto.com",
      role: "STUDENT",
      pubKeyRegistered: false,
    });
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      "Authenticated user not found",
    );
  });
});
