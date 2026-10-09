import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Account, AccountStore } from './account-store';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword, warmDummy } from './password';
import { RateLimiter } from './rate-limit';

export type AuthErrorCode = 'invalid' | 'taken' | 'rate' | 'signup' | 'disabled' | 'unauthenticated' | 'weak' | 'username';

/** A refusal with a stable code (for tests and the client) and a message that is safe to show. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) { super(message); this.name = 'AuthError'; }
  get status(): number {
    return { invalid: 401, taken: 409, rate: 429, signup: 403, disabled: 403, unauthenticated: 401, weak: 400, username: 400 }[this.code];
  }
}

const MAX_SESSION_AGE = 30 * 24 * 60 * 60 * 1000;

export interface AuthOptions {
  /** If set, registering needs this code (SIGNUP_CODE). */
  signupCode?: string;
  now?: () => number;
  sessionMs?: number;
}

export interface Context { ip: string; userAgent: string | null }

/** The account as it is shown to its owner and to the page. Never includes anything secret. */
export interface PublicAccount {
  id: number;
  username: string;
  role: 'player' | 'admin';
  slotSpot: string | null;
  hasLook: boolean;
  mustChangePassword: boolean;
}
export const publicAccount = (a: Account): PublicAccount => ({
  id: a.id, username: a.username, role: a.role, slotSpot: a.slotSpot, hasLook: a.spec !== null, mustChangePassword: a.mustChangePassword,
});

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'server', 'guest', 'you', 'moderator', 'mod', 'staff', 'hazel']);
const DAY = 24 * 60 * 60 * 1000;

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string): boolean => timingSafeEqual(sha256(a), sha256(b));

export class AuthService {
  private readonly now: () => number;
  private readonly sessionMs: number;
  // Wrong passwords: 5 per username from one address in 15 minutes, then that address is locked out of that name for the
  // rest of the window, so a stranger cannot lock the real owner out. 25 from anywhere locks the name for everyone as a
  // last resort. Tracked for names that do not exist too, so a lock cannot be used to find out which names do.
  private readonly failuresByNameAndIp: RateLimiter;
  private readonly failuresByName: RateLimiter;
  private readonly loginsByIp: RateLimiter;
  private readonly registersByIp: RateLimiter;
  private readonly passwordChanges: RateLimiter;

  constructor(private readonly store: AccountStore, private readonly opts: AuthOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sessionMs = opts.sessionMs ?? 7 * DAY;
    this.failuresByNameAndIp = new RateLimiter(5, 15 * 60_000, this.now);
    this.failuresByName = new RateLimiter(25, 15 * 60_000, this.now);
    this.loginsByIp = new RateLimiter(30, 60_000, this.now);
    this.registersByIp = new RateLimiter(5, 10 * 60_000, this.now);
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

  async register(input: { username: unknown; password: unknown; signupCode?: unknown }, ctx: Context): Promise<{ account: Account; token: string }> {
    if (!this.registersByIp.allow(ctx.ip)) throw new AuthError('rate', 'too many sign-ups from here; try again later');
    if (this.opts.signupCode && (typeof input.signupCode !== 'string' || !sameSecret(input.signupCode, this.opts.signupCode))) {
      throw new AuthError('signup', 'the sign-up code is wrong');
    }
    const username = AuthService.cleanUsername(input.username);
    if (RESERVED.has(username.toLowerCase())) throw new AuthError('username', 'that username is reserved');
    const problem = passwordProblem(input.password, username);
    if (problem) throw new AuthError('weak', problem);
    const created = await this.store.create({ username, passwordHash: await hashPassword(input.password as string), role: 'player' });
    if (created === 'taken') throw new AuthError('taken', 'that username is taken');
    await this.store.touchLogin(created.id);
    return { account: created, token: await this.startSession(created, ctx) };
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
    return { account, token: await this.startSession(account, ctx) };
  }

  /** The account behind a session token, or null. Expired sessions are removed; a used session is renewed. */
  async authenticate(token: string | undefined): Promise<Account | null> {
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const found = await this.store.sessionByHash(hash);
    if (!found) return null;
    const t = this.now();
    if (found.session.expiresAt.getTime() <= t || t - found.session.createdAt.getTime() > MAX_SESSION_AGE) { await this.store.deleteSession(hash); return null; }
    if (found.account.disabled) { await this.store.deleteAccountSessions(found.account.id); return null; }
    if (t - found.session.lastSeenAt.getTime() > 60 * 60_000) {
      // renewed, but never past 30 days from when it was made
      const until = Math.min(t + this.sessionMs, found.session.createdAt.getTime() + MAX_SESSION_AGE);
      await this.store.touchSession(hash, new Date(t), new Date(until));
    }
    return found.account;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.store.deleteSession(sha256(token));
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
    await this.store.setPassword(account.id, await hashPassword(next as string), false);
    await this.store.deleteAccountSessions(account.id, currentToken ? sha256(currentToken) : undefined);
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
