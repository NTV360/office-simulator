import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

/** Failed attempts allowed per address per minute before further ones are refused outright. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

/**
 * Admin requests carry the shared secret from ADMIN_TOKEN as `Authorization: Bearer <token>`. Real admin accounts
 * arrive with accounts (phase 3). If ADMIN_TOKEN is not set the admin API does not exist.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly failures = new Map<string, { count: number; since: number }>();

  canActivate(context: ExecutionContext): boolean {
    const token = process.env.ADMIN_TOKEN;
    if (!token) throw new NotFoundException();
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; ip?: string; socket?: { remoteAddress?: string } }>();
    const who = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const f = this.failures.get(who);
    if (f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES) throw new HttpException('too many failed attempts', HttpStatus.TOO_MANY_REQUESTS);

    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(given), b = Buffer.from(token);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      if (!f || now - f.since >= WINDOW_MS) this.failures.set(who, { count: 1, since: now }); else f.count++;
      throw new ForbiddenException();
    }
    this.failures.delete(who);
    return true;
  }
}
