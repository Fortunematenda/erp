import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

// Lightweight in-process rate limiter for fiscal operations. Protects against
// accidental double-submission and abuse of device/credential operations.
// For multi-instance deployments back this with a shared store (Redis).
@Injectable()
export class FiscalRateLimitGuard implements CanActivate {
  private hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const windowMs = Number(process.env.FISCAL_RATE_LIMIT_WINDOW_MS || 60000);
    const max = Number(process.env.FISCAL_RATE_LIMIT_MAX || 120);
    const identity = req.user?.sub || req.ip || 'anonymous';
    const key = `${identity}:${req.method}:${req.route?.path || req.url}`;
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      throw new HttpException('Too many fiscal operations. Please wait a moment and try again.', 429);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
