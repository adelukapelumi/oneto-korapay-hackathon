import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
  constructor(private readonly jwtWrapperService: JwtWrapperService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieToken = this.extractTokenFromCookie(request);
    const bearerToken = this.extractTokenFromHeader(request);
    const token = cookieToken ?? bearerToken;

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      const payload = this.jwtWrapperService.verifyToken(token);
      request.user = payload;
      request.authTokenSource = cookieToken ? 'cookie' : 'bearer';
    } catch {
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
