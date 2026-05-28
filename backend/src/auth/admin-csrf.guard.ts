import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildAllowedCorsOrigins } from "../common/cors";
import { AuthenticatedRequest } from "./jwt-auth.guard";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const originsCsv = this.configService.get<string>("ADMIN_WEB_ORIGINS");
    const nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";
    this.allowedOrigins = new Set(
      buildAllowedCorsOrigins(originsCsv, {
        includeLocalDevOrigins: nodeEnv !== "production",
      }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const origin = this.readHeader(request.headers.origin);
    if (!origin) {
      throw new ForbiddenException("Origin header is required for admin mutations");
    }

    if (!this.allowedOrigins.has(origin)) {
      throw new ForbiddenException("Origin is not allowed for admin mutations");
    }

    const csrfHeader = this.readHeader(request.headers["x-oneto-admin-csrf"]);
    if (csrfHeader !== "1") {
      throw new ForbiddenException("Missing or invalid admin CSRF header");
    }

    return true;
  }

  private readHeader(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
