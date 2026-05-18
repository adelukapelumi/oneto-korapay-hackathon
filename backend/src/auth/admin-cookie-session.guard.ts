import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthenticatedRequest } from "./jwt-auth.guard";

@Injectable()
export class AdminCookieSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.authTokenSource !== "cookie") {
      throw new UnauthorizedException("Admin session must use cookie authentication");
    }

    return true;
  }
}
