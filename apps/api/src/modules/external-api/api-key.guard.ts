import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyScope, ApiKeyService } from './api-key.service';

const SCOPE_KEY = 'nex_api_key_scope';
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(SCOPE_KEY, scope);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private reflector: Reflector, private keys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers['authorization'] || '');
    const secret = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
    if (!secret) throw new UnauthorizedException('API key required');

    const apiKey = await this.keys.authenticate(secret);
    req.apiKey = apiKey;
    req.user = apiKey.user;

    const scope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!scope) return true;
    if (!apiKey.scopes.includes(scope)) throw new ForbiddenException(`API key is missing the ${scope} scope`);
    if (!(await this.keys.ownerStillHas(apiKey, scope))) {
      throw new ForbiddenException(`API key owner no longer has the permissions behind ${scope}`);
    }
    return true;
  }
}
