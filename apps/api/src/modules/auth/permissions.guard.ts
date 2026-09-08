import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from './permission.service';
import { RequestUser } from '../../core/context';

export const PERMISSIONS_KEY = 'nex_permissions';
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private permissionService: PermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required || !required.length) return true;
    const req = context.switchToHttp().getRequest();
    const user: RequestUser = req.user;
    if (!user) return false;
    // Platform administrators operate across the whole platform — they pass any permission check.
    if (user.isPlatformAdmin) return true;
    if (!user.companyId) return false;
    return this.permissionService.hasAny(user, required);
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as RequestUser);
