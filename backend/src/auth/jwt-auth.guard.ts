import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtWrapperService } from './jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtWrapperService: JwtWrapperService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      const payload = this.jwtWrapperService.verifyToken(token);
      // We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      (request as any).user = payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
