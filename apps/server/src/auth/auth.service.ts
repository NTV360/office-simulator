import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Account, AccountStore } from './account-store';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword, warmDummy } from './password';
import { RateLimiter } from './rate-limit';

export type AuthErrorCode = 'invalid' | 'taken' | 'rate' | 'disabled' | 'unauthenticated' | 'weak' | 'username' | 'missing';

/** A refusal with a stable code (for tests and the client) and a message that is safe to show. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) { super(message); this.name = 'AuthError'; }
  get status(): number {
    return { invalid: 401, taken: 409, rate: 429, disabled: 403, unauthenticated: 401, weak: 400, username: 400, missing: 404 }[this.code];
  }
}

const MAX_SESSION_AGE = 30 * 24 * 60 * 60 * 1000;

export interface AuthOptions {
  now?: () => number;
  sessionMs?: number;
  /** Per-address allowance (logins per minute). Tests that log in many times from one address raise it. */
  limits?: { logins?: number };
}

export interface Context { ip: string; userAgent: string | null }

/** Sessions of an account ended: one (`hash`), all but one (`except`), or all (neither). Open realtime connections listen for this. */
export interface SessionEnd { accountId: number; hash?: string; except?: string }

/** The account as it is shown to its owner and to the page. Never includes anything secret. */
export interface PublicAccount {
  id: number;
  username: string;
  role: 'player' | 'admin';
  slotSpot: string | null;
  /** The employee this account plays, or null. */
  employeeId: string | null;
  hasLook: boolean;
  mustChangePassword: boolean;
}
export const publicAccount = (a: Account): PublicAccount => ({
  id: a.id, username: a.username, role: a.role, slotSpot: a.slotSpot, employeeId: a.employeeId, hasLook: a.spec !== null, mustChangePassword: a.mustChangePassword,
});

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'server', 'guest', 'you', 'moderator', 'mod', 'staff', 'hazel']);
const DAY = 24 * 60 * 60 * 1000;

// A password an admin hands out: 12 characters, no look-alikes (no 0/O, 1/l/I), easy to read out or type from a printout.
const READABLE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const generatePassword = (): string => Array.from({ length: 12 }, () => READABLE[randomInt(READABLE.length)]).join('');

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

export class AuthService {
  /** The account storage, for the parts of the server that manage desks and players. */
  readonly accounts: AccountStore;
  private readonly now: () => number;
  private readonly sessionMs: number;
  // Wrong passwords: 5 per username from one address in 15 minutes, then that address is locked out of that name for the
  // rest of the window, so a stranger cannot lock the real owner out. 25 from anywhere locks the name for everyone as a
  // last resort. Tracked for names that do not exist too, so a lock cannot be used to find out which names do.
  private readonly failuresByNameAndIp: RateLimiter;
  private readonly failuresByName: RateLimiter;
  private readonly loginsByIp: RateLimiter;
  private readonly passwordChanges: RateLimiter;
  private readonly endListeners: Array<(e: SessionEnd) => void> = [];

  constructor(private readonly store: AccountStore, private readonly opts: AuthOptions = {}) {
    this.accounts = store;
    this.now = opts.now ?? Date.now;
    this.sessionMs = opts.sessionMs ?? 7 * DAY;
    this.failuresByNameAndIp = new RateLimiter(5, 15 * 60_000, this.now);
    this.failuresByName = new RateLimiter(25, 15 * 60_000, this.now);
    this.loginsByIp = new RateLimiter(opts.limits?.logins ?? 30, 60_000, this.now);
    this.passwordChanges = new RateLimiter(5, 15 * 60_000, this.now);
    void warmDummy();
  }

  /** Check a username against the rules; returns the trimmed name or throws. */
  static cleanUsername(raw: unknown): string {
    if (typeof raw !== 'string') throw new AuthError('username', 'the username must be text');
    const name = raw.trim();
    if (!USERNAME.test(name)) throw new AuthError('username', 'the username must be 3 to 24 characters: letters, digits, dot, dash and underscore');
    return name;
  }

  /**
   * Make a player account. Only an admin does this (there is no self-service sign-up: everybody in the office is given a station).
   * `mustChange`: the person has to choose their own password before they can play (an admin sets the first one).
   */
  async createAccount(input: { username: unknown; password: unknown; mustChange?: boolean }): Promise<Account> {
    const username = AuthService.cleanUsername(input.username);
    if (RESERVED.has(username.toLowerCase())) throw new AuthError('username', 'that username is reserved');
    const problem = passwordProblem(input.password, username);
    if (problem) throw new AuthError('weak', problem);
    const created = await this.store.create({ username, passwordHash: await hashPassword(input.password as string), role: 'player', mustChangePassword: input.mustChange ?? false });
    if (created === 'taken') throw new AuthError('taken', 'that username is taken');
    return created;
  }

  async login(input: { username: unknown; password: unknown }, ctx: Context): Promise<{ account: Account; token: string }> {
    if (!this.loginsByIp.allow(ctx.ip)) throw new AuthError('rate', 'too many attempts from here; try again in a minute');
    const bad = new AuthError('invalid', 'invalid username or password');
    // anything that could not possibly be a username is refused before it touches a counter or the database
    if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 1024) throw bad;
    if (input.username.length > 64 || /[\u0000-\u001f\u007f]/.test(input.username)) throw bad;
    const lower = input.username.trim().toLowerCase();
    const pair = `${lower}|${ctx.ip}`;
    if (!this.failuresByNameAndIp.wouldAllow(pair) || !this.failuresByName.wouldAllow(lower)) throw new AuthError('rate', 'too many wrong passwords for that account; try again in a while');
    const account = await this.store.byLower(lower);
    // always do the same work, whether or not the name exists
    const ok = account ? await verifyPassword(account.passwordHash, input.password) : await verifyAgainstDummy(input.password);
    if (!account || !ok) { this.failuresByNameAndIp.allow(pair); this.failuresByName.allow(lower); throw bad; }
    if (account.disabled) throw new AuthError('disabled', 'this account has been disabled; ask an admin');
    this.failuresByNameAndIp.reset(pair);
    await this.store.touchLogin(account.id);
    const token = await this.startSession(account, ctx);
    // The password was checked a moment ago (argon2 is slow). If an admin reset it, or disabled the account, in that moment,
    // the session just made belongs to an old password: drop it.
    const now = await this.store.byId(account.id);
    if (!now || now.passwordHash !== account.passwordHash || now.disabled) {
      await this.store.deleteSession(sha256(token));
      throw bad;
    }
    return { account, token };
  }

  /** The account behind a session token, or null. Expired sessions are removed; a used session is renewed. */
  async authenticate(token: string | undefined): Promise<Account | null> {
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const found = await this.store.sessionByHash(hash);
    if (!found) return null;
    const t = this.now();
    if (found.session.expiresAt.getTime() <= t || t - found.session.createdAt.getTime() > MAX_SESSION_AGE) { await this.store.deleteSession(hash); return null; }
    if (found.account.disabled) { await this.store.deleteAccountSessions(found.account.id); this.ended({ accountId: found.account.id }); return null; }
    if (t - found.session.lastSeenAt.getTime() > 60 * 60_000) {
      // renewed, but never past 30 days from when it was made
      const until = Math.min(t + this.sessionMs, found.session.createdAt.getTime() + MAX_SESSION_AGE);
      await this.store.touchSession(hash, new Date(t), new Date(until));
    }
    return found.account;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const hash = sha256(token);
    const found = await this.store.sessionByHash(hash);
    await this.store.deleteSession(hash);
    if (found) this.ended({ accountId: found.account.id, hash: hash.toString('hex') });
  }

  /** Listen for sessions ending (logout, a password change, an account being disabled). */
  onSessionEnd(fn: (e: SessionEnd) => void): void { this.endListeners.push(fn); }
  private ended(e: SessionEnd): void { for (const fn of this.endListeners) { try { fn(e); } catch { /* a listener must not break a logout */ } } }

  /** The account with this id (used when a ticket is redeemed), or null. */
  accountById(id: number): Promise<Account | null> { return this.store.byId(id); }

  /** Is the session with this hash (hex) still alive? */
  async sessionAlive(hashHex: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(hashHex)) return false;
    const found = await this.store.sessionByHash(Buffer.from(hashHex, 'hex'));
    if (!found || found.account.disabled) return false;
    const t = this.now();
    return found.session.expiresAt.getTime() > t && t - found.session.createdAt.getTime() <= MAX_SESSION_AGE;
  }

  /** End every session of an account (an admin disabling it, for example). */
  async endAllSessions(accountId: number): Promise<void> {
    await this.store.deleteAccountSessions(accountId);
    this.ended({ accountId });
  }

  /**
   * An admin sets (or, with no password given, generates) an account's password. The person must choose their own at the next
   * login, and every session and connection the account has ends. Returns the password so the admin can read it out: it is
   * shown once and cannot be looked up afterwards (only a one-way hash is kept).
   */
  async adminSetPassword(id: number, password?: unknown): Promise<{ account: Account; password: string }> {
    const account = await this.store.byId(id);
    if (!account) throw new AuthError('missing', 'there is no such account');
    const chosen = password === undefined || password === '' ? generatePassword() : password;
    const problem = passwordProblem(chosen, account.username);
    if (problem) throw new AuthError('weak', problem);
    await this.store.setPassword(id, await hashPassword(chosen as string), true);
    // a person locked out by wrong passwords is let back in by the reset (it is how an admin helps them)
    this.failuresByName.reset(account.usernameLower);
    this.failuresByNameAndIp.resetPrefix(account.usernameLower + '|');
    await this.endAllSessions(id);
    return { account: (await this.store.byId(id))!, password: chosen as string };
  }

  /** Mute or unmute an account: it can still play, but its chat is not sent to anyone. */
  async setMuted(id: number, muted: boolean): Promise<Account> {
    if (!(await this.store.byId(id))) throw new AuthError('missing', 'there is no such account');
    await this.store.setMuted(id, muted);
    return (await this.store.byId(id))!;
  }

  /** Disable (cannot log in; connections end) or enable an account. */
  async setDisabled(id: number, disabled: boolean): Promise<Account> {
    if (!(await this.store.byId(id))) throw new AuthError('missing', 'there is no such account');
    await this.store.setDisabled(id, disabled);
    if (disabled) await this.endAllSessions(id);
    return (await this.store.byId(id))!;
  }

  /** Change your own password. Every other session of the account ends. */
  async changePassword(account: Account, currentToken: string | undefined, current: unknown, next: unknown): Promise<void> {
    if (!this.passwordChanges.wouldAllow(String(account.id))) throw new AuthError('rate', 'too many wrong passwords; try again in a while');
    if (typeof current !== 'string' || current.length > 1024 || !(await verifyPassword(account.passwordHash, current))) {
      this.passwordChanges.allow(String(account.id));
      throw new AuthError('invalid', 'the current password is wrong');
    }
    const problem = passwordProblem(next, account.username);
    if (problem) throw new AuthError('weak', problem);
    if (next === current) throw new AuthError('weak', 'choose a different password from the old one');
    const fresh = await this.store.byId(account.id);
    if (!fresh || fresh.passwordHash !== account.passwordHash) throw new AuthError('invalid', 'your password was changed meanwhile; log in again'); // (an admin reset it while this was being checked)
    await this.store.setPassword(account.id, await hashPassword(next as string), false);
    await this.store.deleteAccountSessions(account.id, currentToken ? sha256(currentToken) : undefined);
    this.ended({ accountId: account.id, except: currentToken ? sha256(currentToken).toString('hex') : undefined });
  }

  /** At start-up: if there is no admin and the environment names one, create it. Returns what happened. */
  async bootstrapAdmin(username: string | undefined, password: string | undefined): Promise<'created' | 'exists' | 'not configured' | 'refused'> {
    if (!username || !password) return 'not configured';
    if (await this.store.countAdmins() > 0) return 'exists';
    const problem = passwordProblem(password, username);
    if (problem || !USERNAME.test(username)) return 'refused';
    const made = await this.store.create({ username, passwordHash: await hashPassword(password), role: 'admin' });
    return made === 'taken' ? 'refused' : 'created';
  }

  /** Remove sessions that have run out. */
  purgeExpired(): Promise<number> { return this.store.deleteExpiredSessions(new Date(this.now())); }

  private async startSession(account: Account, ctx: Context): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.store.createSession(account.id, sha256(token), new Date(this.now() + this.sessionMs), ctx.userAgent?.slice(0, 200) ?? null);
    return token;
  }
}
