import { ArgumentsHost, Catch, ExceptionFilter, Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db.service';
import { runMigrations } from '../db/migrate';
import { PgAccountStore } from './account-store';
import { AuthError, AuthService, type SessionEnd } from './auth.service';

/** Builds the AuthService on the database, applies the migrations it needs, creates the first admin, and cleans up old sessions. */
@Injectable()
export class AuthProvider implements OnApplicationBootstrap, OnApplicationShutdown {
  private service: AuthService | null = null;
  private readonly endListeners: Array<(e: SessionEnd) => void> = [];
  private readyResolve!: () => void;
  /** Resolves when start-up is over (accounts are on, or switched off for lack of a database). */
  readonly ready = new Promise<void>(res => { this.readyResolve = res; });
  private timer: NodeJS.Timeout | null = null;
  private readonly log = new Logger('Auth');

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** The service, or a 503 when the server has no database (accounts need one). */
  require(): AuthService {
    if (!this.service) throw new ServiceUnavailableException('accounts are not available: the server has no database');
    return this.service;
  }

  get available(): boolean { return this.service !== null; }

  /** Use this service instead of the database one (tests give it an in-memory store). */
  useService(service: AuthService): void { this.service = service; service.onSessionEnd(e => this.endListeners.forEach(fn => fn(e))); }

  /** Hear about sessions ending, whichever service instance is current. */
  onSessionEnd(fn: (e: SessionEnd) => void): void { this.endListeners.push(fn); }

  async onApplicationBootstrap(): Promise<void> {
    try { await this.start(); } finally { this.readyResolve(); }
  }

  private async start(): Promise<void> {
    if (process.env.ADMIN_TOKEN && !process.env.TRUST_PROXY) this.log.warn('ADMIN_TOKEN is set but TRUST_PROXY is not: behind a proxy, every client looks like one address and ten wrong admin passwords from anyone lock the admin out');
    const pool = this.db.pool;
    if (!pool) { this.log.warn('no DATABASE_URL: accounts are switched off'); return; }
    for (let attempt = 1; ; attempt++) {
      try { await runMigrations(pool); break; } catch (err) {
        if (attempt >= 10) { this.log.error(`accounts are switched off: the database is not ready (${err instanceof Error ? err.message : String(err)})`); return; }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    const service = new AuthService(new PgAccountStore(pool));
    const boot = await service.bootstrapAdmin(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
    if (boot === 'created') this.log.log(`created the first admin account "${process.env.ADMIN_USERNAME}"`);
    else if (boot === 'refused') this.log.error('ADMIN_USERNAME / ADMIN_PASSWORD were refused (the name is taken or invalid, or the password is too weak); no admin was created');
    this.useService(service);
    this.timer = setInterval(() => { service.purgeExpired().catch(() => {}); }, 60 * 60_000);
  }

  onApplicationShutdown(): void { if (this.timer) clearInterval(this.timer); }
}

/** Turns an AuthError into the right HTTP answer (everything else keeps Nest's default handling). */
@Catch(AuthError)
export class AuthErrorFilter implements ExceptionFilter {
  catch(err: AuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    res.status(err.status).json({ statusCode: err.status, code: err.code, message: err.message });
  }
}

