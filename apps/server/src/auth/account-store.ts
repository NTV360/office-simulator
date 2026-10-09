import type { Pool } from 'pg';

export type Role = 'player' | 'admin';

export interface Account {
  id: number;
  username: string;
  usernameLower: string;
  passwordHash: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  /** The desk an admin gave this account (a spot id such as 'desk:12'), or null while it is waiting for one. */
  slotSpot: string | null;
  spec: unknown | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface SessionInfo {
  id: number;
  accountId: number;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

/** One line of the admin audit log: what an admin did. Never holds a password. */
export interface AuditRow { id: number; at: Date; actor: string; action: string; target: string | null; detail: unknown | null }

/** Everything the auth code needs from storage. PostgreSQL in production, a Map in the fast tests. */
export interface AccountStore {
  /** Create an account, or return 'taken' if the username (any capitalisation) exists. */
  create(a: { username: string; passwordHash: string; role: Role; mustChangePassword?: boolean }): Promise<Account | 'taken'>;
  byLower(usernameLower: string): Promise<Account | null>;
  byId(id: number): Promise<Account | null>;
  countAdmins(): Promise<number>;
  setPassword(id: number, passwordHash: string, mustChange: boolean): Promise<void>;
  /** Every account, oldest first (for the admin). */
  list(): Promise<Account[]>;
  /** Give the account a desk (a spot id) or take it away (null). 'taken' if another account has that desk, 'missing' if there is no such account. */
  setSlot(id: number, slotSpot: string | null): Promise<'ok' | 'taken' | 'missing'>;
  /** Remember the account's character look (already normalised). */
  setSpec(id: number, spec: unknown): Promise<void>;
  /** Disable or enable the account (a disabled account cannot log in). */
  setDisabled(id: number, disabled: boolean): Promise<void>;
  /** Add a line to the audit log. */
  audit(a: { actorName: string; action: string; target?: string | null; detail?: unknown }): Promise<void>;
  /** The newest audit lines first. */
  recentAudit(limit: number): Promise<AuditRow[]>;
  touchLogin(id: number): Promise<void>;
  createSession(accountId: number, tokenHash: Buffer, expiresAt: Date, userAgent: string | null): Promise<void>;
  sessionByHash(tokenHash: Buffer): Promise<{ session: SessionInfo; account: Account } | null>;
  touchSession(tokenHash: Buffer, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  deleteSession(tokenHash: Buffer): Promise<void>;
  /** End every session of an account, optionally keeping one (the one asking). */
  deleteAccountSessions(accountId: number, except?: Buffer): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;
}

interface AccountRow {
  id: number; username: string; username_lower: string; password_hash: string; role: Role; disabled: boolean;
  must_change_password: boolean; slot_spot: string | null; spec: unknown | null; created_at: Date; last_login_at: Date | null;
}
const toAccount = (r: AccountRow): Account => ({
  id: r.id, username: r.username, usernameLower: r.username_lower, passwordHash: r.password_hash, role: r.role, disabled: r.disabled,
  mustChangePassword: r.must_change_password, slotSpot: r.slot_spot, spec: r.spec, createdAt: r.created_at, lastLoginAt: r.last_login_at,
});

export class PgAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async create(a: { username: string; passwordHash: string; role: Role; mustChangePassword?: boolean }): Promise<Account | 'taken'> {
    try {
      const r = await this.pool.query<AccountRow>(
        'INSERT INTO accounts (username, username_lower, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [a.username, a.username.toLowerCase(), a.passwordHash, a.role, a.mustChangePassword ?? false],
      );
      return toAccount(r.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return 'taken'; // unique_violation
      throw err;
    }
  }

  async byLower(usernameLower: string): Promise<Account | null> {
    const r = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE username_lower = $1', [usernameLower]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async byId(id: number): Promise<Account | null> {
    const r = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async countAdmins(): Promise<number> {
    const r = await this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts WHERE role = 'admin'");
    return r.rows[0].n;
  }

  async setPassword(id: number, passwordHash: string, mustChange: boolean): Promise<void> {
    await this.pool.query('UPDATE accounts SET password_hash = $2, must_change_password = $3 WHERE id = $1', [id, passwordHash, mustChange]);
  }

  async touchLogin(id: number): Promise<void> {
    await this.pool.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [id]);
  }

  async list(): Promise<Account[]> {
    const r = await this.pool.query<AccountRow>('SELECT * FROM accounts ORDER BY id');
    return r.rows.map(toAccount);
  }

  async setSlot(id: number, slotSpot: string | null): Promise<'ok' | 'taken' | 'missing'> {
    try {
      const r = await this.pool.query('UPDATE accounts SET slot_spot = $2 WHERE id = $1', [id, slotSpot]);
      return r.rowCount === 0 ? 'missing' : 'ok';
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return 'taken'; // another account already has that desk
      throw err;
    }
  }

  async setSpec(id: number, spec: unknown): Promise<void> {
    await this.pool.query('UPDATE accounts SET spec = $2 WHERE id = $1', [id, JSON.stringify(spec)]);
  }

  async setDisabled(id: number, disabled: boolean): Promise<void> {
    await this.pool.query('UPDATE accounts SET disabled = $2 WHERE id = $1', [id, disabled]);
  }

  async audit(a: { actorName: string; action: string; target?: string | null; detail?: unknown }): Promise<void> {
    await this.pool.query('INSERT INTO audit_log (actor_name, action, target, detail) VALUES ($1, $2, $3, $4)', [a.actorName, a.action, a.target ?? null, a.detail === undefined ? null : JSON.stringify(a.detail)]);
  }

  async recentAudit(limit: number): Promise<AuditRow[]> {
    const r = await this.pool.query<{ id: string; at: Date; actor_name: string; action: string; target: string | null; detail: unknown | null }>('SELECT id, at, actor_name, action, target, detail FROM audit_log ORDER BY id DESC LIMIT $1', [limit]);
    return r.rows.map(x => ({ id: Number(x.id), at: x.at, actor: x.actor_name, action: x.action, target: x.target, detail: x.detail }));
  }

  async createSession(accountId: number, tokenHash: Buffer, expiresAt: Date, userAgent: string | null): Promise<void> {
    await this.pool.query('INSERT INTO sessions (account_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [accountId, tokenHash, expiresAt, userAgent]);
  }

  async sessionByHash(tokenHash: Buffer): Promise<{ session: SessionInfo; account: Account } | null> {
    const r = await this.pool.query<AccountRow & { sid: number; s_expires: Date; s_seen: Date; s_created: Date }>(
      `SELECT a.*, s.id AS sid, s.expires_at AS s_expires, s.last_seen_at AS s_seen, s.created_at AS s_created
         FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1`, [tokenHash]);
    const row = r.rows[0];
    if (!row) return null;
    return { session: { id: row.sid, accountId: row.id, createdAt: row.s_created, expiresAt: row.s_expires, lastSeenAt: row.s_seen }, account: toAccount(row) };
  }

  async touchSession(tokenHash: Buffer, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.pool.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1', [tokenHash, lastSeenAt, expiresAt]);
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteAccountSessions(accountId: number, except?: Buffer): Promise<void> {
    if (except) await this.pool.query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, except]);
    else await this.pool.query('DELETE FROM sessions WHERE account_id = $1', [accountId]);
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    const r = await this.pool.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
    return r.rowCount ?? 0;
  }
}

/** A store that lives in memory: the same behaviour, for fast tests of the auth rules. */
export class MemoryAccountStore implements AccountStore {
  readonly accounts = new Map<number, Account>();
  readonly sessions = new Map<string, { info: SessionInfo; userAgent: string | null }>();
  private nextId = 1;
  private nextSession = 1;

  async create(a: { username: string; passwordHash: string; role: Role; mustChangePassword?: boolean }): Promise<Account | 'taken'> {
    const lower = a.username.toLowerCase();
    for (const x of this.accounts.values()) if (x.usernameLower === lower) return 'taken';
    const acc: Account = { id: this.nextId++, username: a.username, usernameLower: lower, passwordHash: a.passwordHash, role: a.role, disabled: false, mustChangePassword: a.mustChangePassword ?? false, slotSpot: null, spec: null, createdAt: new Date(), lastLoginAt: null };
    this.accounts.set(acc.id, acc);
    return { ...acc };
  }
  async byLower(l: string) { for (const x of this.accounts.values()) if (x.usernameLower === l) return { ...x }; return null; }
  async byId(id: number) { const x = this.accounts.get(id); return x ? { ...x } : null; }
  async countAdmins() { return [...this.accounts.values()].filter(x => x.role === 'admin').length; }
  async setPassword(id: number, h: string, mustChange: boolean) { const x = this.accounts.get(id)!; x.passwordHash = h; x.mustChangePassword = mustChange; }
  async touchLogin(id: number) { this.accounts.get(id)!.lastLoginAt = new Date(); }
  async list() { return [...this.accounts.values()].map(a => ({ ...a })); }
  async setSlot(id: number, slotSpot: string | null) {
    const a = this.accounts.get(id);
    if (!a) return 'missing' as const;
    if (slotSpot !== null && [...this.accounts.values()].some(x => x.id !== id && x.slotSpot === slotSpot)) return 'taken' as const;
    a.slotSpot = slotSpot;
    return 'ok' as const;
  }
  async setSpec(id: number, spec: unknown) { this.accounts.get(id)!.spec = spec; }
  async setDisabled(id: number, disabled: boolean) { this.accounts.get(id)!.disabled = disabled; }
  readonly auditLog: AuditRow[] = [];
  async audit(a: { actorName: string; action: string; target?: string | null; detail?: unknown }) { this.auditLog.push({ id: this.auditLog.length + 1, at: new Date(), actor: a.actorName, action: a.action, target: a.target ?? null, detail: a.detail ?? null }); }
  async recentAudit(limit: number) { return [...this.auditLog].reverse().slice(0, limit); }
  async createSession(accountId: number, tokenHash: Buffer, expiresAt: Date, userAgent: string | null) {
    this.sessions.set(tokenHash.toString('hex'), { info: { id: this.nextSession++, accountId, createdAt: new Date(), expiresAt, lastSeenAt: new Date() }, userAgent });
  }
  async sessionByHash(h: Buffer) {
    const s = this.sessions.get(h.toString('hex'));
    if (!s) return null;
    const account = this.accounts.get(s.info.accountId);
    return account ? { session: { ...s.info }, account: { ...account } } : null;
  }
  async touchSession(h: Buffer, lastSeenAt: Date, expiresAt: Date) { const s = this.sessions.get(h.toString('hex')); if (s) { s.info.lastSeenAt = lastSeenAt; s.info.expiresAt = expiresAt; } }
  async deleteSession(h: Buffer) { this.sessions.delete(h.toString('hex')); }
  async deleteAccountSessions(accountId: number, except?: Buffer) {
    for (const [k, v] of this.sessions) if (v.info.accountId === accountId && k !== except?.toString('hex')) this.sessions.delete(k);
  }
  async deleteExpiredSessions(now: Date) {
    let n = 0;
    for (const [k, v] of this.sessions) if (v.info.expiresAt < now) { this.sessions.delete(k); n++; }
    return n;
  }
}
