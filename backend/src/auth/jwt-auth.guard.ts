import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Request } from 'express';
import { JwtWrapperService } from './jwt.service';
import { ADMIN_SESSION_COOKIE_NAME } from './admin-session.constants';

export type AuthTokenSource = 'cookie' | 'bearer';

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email: string;
    role: string;
    pubKeyRegistered: boolean;
  };
  authTokenSource?: AuthTokenSource;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtWrapperService: JwtWrapperService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieToken = this.extractTokenFromCookie(request);
    const bearerToken = this.extractTokenFromHeader(request);
    const token = cookieToken ?? bearerToken;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      const payload = this.jwtWrapperService.verifyToken(token);
      request.authTokenSource = cookieToken ? 'cookie' : 'bearer';

      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          publicKey: true,
        },
      });

      if (!dbUser) {
        throw new UnauthorizedException('Authenticated user not found');
      }

      if (dbUser.status === 'FROZEN' || dbUser.status === 'FLAGGED') {
        throw new ForbiddenException('Account is not active');
      }

      // Always project auth context from current DB state. This prevents
      // stale JWT claims (role/status/public key registration) from granting
      // permissions after server-side account changes.
      request.user = {
        sub: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        pubKeyRegistered: dbUser.publicKey !== null,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private extractTokenFromCookie(request: Request): string | undefined {
    const rawCookieHeader = request.headers.cookie;
    if (!rawCookieHeader) {
      return undefined;
    }

    for (const segment of rawCookieHeader.split(';')) {
      const [rawName, ...rawValueParts] = segment.trim().split('=');
      if (!rawName || rawValueParts.length === 0) {
        continue;
      }

      if (rawName !== ADMIN_SESSION_COOKIE_NAME) {
        continue;
      }

      const rawValue = rawValueParts.join('=');
      return decodeURIComponent(rawValue);
    }

    return undefined;
  }
}
