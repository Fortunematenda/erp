import { ForbiddenException } from '@nestjs/common';
export type RequestUser={sub:string;email:string;tenantId?:string;companyId?:string;role?:string;isPlatformAdmin?:boolean};
export function companyIdOf(user:RequestUser){if(!user.companyId) throw new ForbiddenException('Company context required'); return user.companyId}
export function tenantIdOf(user:RequestUser){if(!user.tenantId) throw new ForbiddenException('Tenant context required'); return user.tenantId}
