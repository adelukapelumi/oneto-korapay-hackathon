import { Injectable, CanActivate, ExecutionContext, ForbiddenException, mixin, Type } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * RolesGuard factory. Usage:
 * @UseGuards(JwtAuthGuard, RolesGuard(['MERCHANT']))
 */
export const RolesGuard = (allowedRoles: (Role | string)[]): Type<CanActivate> => {
  @Injectable()
  class RolesGuardMixin implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();
      const user = request.user;

      if (!user || !user.role) {
        throw new ForbiddenException('User role not found in request');
      }

      if (!allowedRoles.includes(user.role)) {
        throw new ForbiddenException('Insufficient permissions');
      }

      return true;
    }
  }

  return mixin(RolesGuardMixin);
};
