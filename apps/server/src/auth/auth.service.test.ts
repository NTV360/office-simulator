import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAccountStore } from './account-store';
import { AuthError, AuthService, publicAccount } from './auth.service';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { RateLimiter } from './rate-limit';

const ctx = (ip = '10.0.0.1') => ({ ip, userAgent: 'test' });
const GOOD = 'correct-horse-battery';

let now: number;
let store: MemoryAccountStore;
let auth: AuthService;
const advance = (ms: number) => { now += ms; };
beforeEach(() => {
  now = Date.UTC(2026, 9, 9, 9, 0, 0);
  store = new MemoryAccountStore();
  auth = new AuthService(store, { now: () => now });
});

const refused = async (p: Promise<unknown>): Promise<AuthError> => { try { await p; } catch (e) { return e as AuthError; } throw new Error('expected a refusal'); };
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof AuthError ? e.code : 'other:' + String(e); } };

describe('passwords', () => {
  it('are hashed with argon2id, salted, and checked', async () => {
    const a = await hashPassword(GOOD), b = await hashPassword(GOOD);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // different salts
    expect(a).not.toContain(GOOD);
    expect(await verifyPassword(a, GOOD)).toBe(true);
    expect(await verifyPassword(a, GOOD + 'x')).toBe(false);
    expect(await verifyPassword('not a hash', GOOD)).toBe(false); // damaged data is a no, never a crash
  });
  it('must be long enough, not too long, not common, not the username', () => {
    expect(passwordProblem(GOOD, 'ana')).toBeNull();
    expect(passwordProblem('short', 'ana')).toMatch(/at least 8/);
    expect(passwordProblem('x'.repeat(129), 'ana')).toMatch(/at most 128/);
    expect(passwordProblem('ab'.repeat(64), 'ana')).toBeNull();
    expect(passwordProblem('Password123', 'ana')).toMatch(/common/);
    expect(passwordProblem('anaanaana', 'anaanaana')).toMatch(/username/);
    expect(passwordProblem('ANAANAANA', 'anaanaana')).toMatch(/username/);
    expect(passwordProblem('aaaaaaaaaa', 'ana')).toMatch(/repeated/);
    expect(passwordProblem(12345678, 'ana')).toMatch(/text/);
    expect(passwordProblem(undefined, 'ana')).toMatch(/text/);
  });
});

describe('register', () => {
  it('creates a player account and a session', async () => {
    const { account, token } = await auth.register({ username: 'Ana_B', password: GOOD }, ctx());
    expect(account).toMatchObject({ username: 'Ana_B', usernameLower: 'ana_b', role: 'player', disabled: false, slotSpot: null });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await auth.authenticate(token))?.id).toBe(account.id);
  });

  it('keeps only a hash of the password and of the session token', async () => {
    const { account, token } = await auth.register({ username: 'ana', password: GOOD }, ctx());
    const stored = store.accounts.get(account.id)!;
    expect(stored.passwordHash).not.toContain(GOOD);
    expect([...store.sessions.keys()]).toEqual([createHash('sha256').update(token).digest('hex')]);
    expect(JSON.stringify([...store.sessions.keys()])).not.toContain(token);
  });

  it('what is shown to the page has nothing secret in it', async () => {
    const { account } = await auth.register({ username: 'ana', password: GOOD }, ctx());
    const shown = JSON.stringify(publicAccount(account));
    expect(shown).not.toContain('argon2');
    expect(shown).not.toContain(GOOD);
    expect(Object.keys(publicAccount(account)).sort()).toEqual(['hasLook', 'id', 'mustChangePassword', 'role', 'slotSpot', 'username']);
  });

  it('usernames: 3 to 24 of letters, digits, dot, dash, underscore; trimmed; unique whatever the capitals', async () => {
    for (const bad of ['', 'ab', 'a'.repeat(25), 'has space', 'semi;colon', 'ünï', '<b>x</b>', "o'brien", 5, null, undefined, {}, ['x']]) {
      expect(await code(auth.register({ username: bad, password: GOOD }, ctx(`bad-${String(bad)}`))), JSON.stringify(bad)).toBe('username');
    }
    const { account } = await auth.register({ username: '  Marco.C  ', password: GOOD }, ctx());
    expect(account.username).toBe('Marco.C');
    expect(await code(auth.register({ username: 'MARCO.c', password: GOOD }, ctx('b')))).toBe('taken');
    expect(await code(auth.register({ username: 'marco.c', password: GOOD }, ctx('c')))).toBe('taken');
  });

  it('names that could pass for the system are reserved', async () => {
    for (const n of ['admin', 'Admin', 'ROOT', 'system', 'Guest', 'you', 'hazel']) expect(await code(auth.register({ username: n, password: GOOD }, ctx('r' + n))), n).toBe('username');
  });

  it('weak passwords are refused with the reason', async () => {
    expect(await code(auth.register({ username: 'ana', password: 'short' }, ctx()))).toBe('weak');
    expect(await code(auth.register({ username: 'ana', password: 'password123' }, ctx('b')))).toBe('weak');
    expect(await code(auth.register({ username: 'ana', password: undefined }, ctx('c')))).toBe('weak');
    expect(store.accounts.size).toBe(0);
  });

  it('needs the sign-up code when one is configured', async () => {
    const guarded = new AuthService(store, { now: () => now, signupCode: 'office-2026' });
    expect(await code(guarded.register({ username: 'ana', password: GOOD }, ctx()))).toBe('signup');
    expect(await code(guarded.register({ username: 'ana', password: GOOD, signupCode: 'wrong' }, ctx('b')))).toBe('signup');
    expect(await code(guarded.register({ username: 'ana', password: GOOD, signupCode: 5 }, ctx('c')))).toBe('signup');
    expect(await code(guarded.register({ username: 'ana', password: GOOD, signupCode: 'office-2026' }, ctx('d')))).toBe('ok');
  });

  it('is limited per address: five in ten minutes', async () => {
    for (let i = 0; i < 5; i++) await auth.register({ username: 'user' + i, password: GOOD }, ctx('9.9.9.9'));
    expect(await code(auth.register({ username: 'user5', password: GOOD }, ctx('9.9.9.9')))).toBe('rate');
    expect(await code(auth.register({ username: 'other', password: GOOD }, ctx('8.8.8.8')))).toBe('ok');
    advance(10 * 60_000 + 1);
    expect(await code(auth.register({ username: 'user5', password: GOOD }, ctx('9.9.9.9')))).toBe('ok');
  });
});

describe('login', () => {
  beforeEach(async () => { await auth.register({ username: 'Ana', password: GOOD }, ctx('setup')); });

  it('works with any capitalisation of the name', async () => {
    for (const n of ['Ana', 'ana', 'ANA', ' ana ']) expect(await code(auth.login({ username: n, password: GOOD }, ctx()))).toBe('ok');
  });

  it('a wrong password and an unknown name get exactly the same answer', async () => {
    const wrong = await refused(auth.login({ username: 'ana', password: 'nope-nope-nope' }, ctx()));
    const unknown = await refused(auth.login({ username: 'nobody', password: 'nope-nope-nope' }, ctx()));
    expect([wrong.code, wrong.status, wrong.message]).toEqual([unknown.code, unknown.status, unknown.message]);
    expect(wrong.message).toBe('invalid username or password');
  });

  it('bad input is simply invalid, never a crash', async () => {
    for (const bad of [{ username: 5, password: GOOD }, { username: 'ana', password: 5 }, { username: null, password: null }, { username: 'ana', password: 'x'.repeat(2000) }, {} as never]) {
      expect(await code(auth.login(bad as { username: unknown; password: unknown }, ctx()))).toBe('invalid');
    }
  });

  it('five wrong passwords from one address lock that address out of that name for fifteen minutes, even with the right one', async () => {
    for (let i = 0; i < 5; i++) expect(await code(auth.login({ username: 'ana', password: 'wrong-' + i + 'xxxx' }, ctx('thief')))).toBe('invalid');
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('thief')))).toBe('rate');
    advance(14 * 60_000);
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('thief')))).toBe('rate');
    advance(61_000);
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('thief')))).toBe('ok');
  });

  it('a stranger guessing cannot lock the real owner out: the owner, from their own address, still gets in', async () => {
    for (let i = 0; i < 12; i++) await auth.login({ username: 'ana', password: 'wrong-' + i + 'xxxx' }, ctx('thief')).catch(() => {});
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('owner')))).toBe('ok');
  });

  it('but guessing from very many addresses locks the name for everyone, as a last resort', async () => {
    for (let i = 0; i < 25; i++) await auth.login({ username: 'ana', password: 'wrong-' + i + 'xxxx' }, ctx('bot' + i)).catch(() => {});
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('owner')))).toBe('rate');
    advance(15 * 60_000 + 1000);
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('owner')))).toBe('ok');
  });

  it('a name that does not exist locks the same way, so the lock cannot be used to find real names', async () => {
    for (let i = 0; i < 5; i++) await auth.login({ username: 'ghost', password: 'wrong-' + i + 'xxxx' }, ctx('g')).catch(() => {});
    const e = await refused(auth.login({ username: 'ghost', password: 'wrong-yyyyy' }, ctx('g')));
    expect(e.code).toBe('rate');
  });

  it('a successful login clears the count of wrong ones', async () => {
    for (let i = 0; i < 4; i++) await auth.login({ username: 'ana', password: 'wrong-' + i + 'xxxx' }, ctx('b')).catch(() => {});
    await auth.login({ username: 'ana', password: GOOD }, ctx('b'));
    for (let i = 0; i < 4; i++) expect(await code(auth.login({ username: 'ana', password: 'wrong-' + i + 'yyyy' }, ctx('b')))).toBe('invalid');
  });

  it('is limited per address (30 a minute) whatever the names', async () => {
    for (let i = 0; i < 30; i++) await auth.login({ username: 'n' + i, password: 'wrong-wrong' }, ctx('7.7.7.7')).catch(() => {});
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('7.7.7.7')))).toBe('rate');
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('6.6.6.6')))).toBe('ok');
  });

  it('a disabled account cannot log in, and says so only to someone with the right password', async () => {
    store.accounts.get(1)!.disabled = true;
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx()))).toBe('disabled');
    expect(await code(auth.login({ username: 'ana', password: 'wrong-wrong-1' }, ctx('b')))).toBe('invalid');
  });

  it('each login is its own session', async () => {
    const a = await auth.login({ username: 'ana', password: GOOD }, ctx('1'));
    const b = await auth.login({ username: 'ana', password: GOOD }, ctx('2'));
    expect(a.token).not.toBe(b.token);
    await auth.logout(a.token);
    expect(await auth.authenticate(a.token)).toBeNull();
    expect(await auth.authenticate(b.token)).not.toBeNull();
  });
});

describe('sessions', () => {
  let token: string;
  beforeEach(async () => { token = (await auth.register({ username: 'ana', password: GOOD }, ctx('s'))).token; });

  it('are refused when missing, unknown, garbage or absurdly long', async () => {
    for (const t of [undefined, '', 'nope', 'x'.repeat(500), token.slice(1), token + 'x']) expect(await auth.authenticate(t)).toBeNull();
  });

  it('last seven days from the last use, and are removed once expired', async () => {
    advance(6 * 24 * 60 * 60_000);
    expect(await auth.authenticate(token)).not.toBeNull(); // used on day 6: renewed
    advance(6 * 24 * 60 * 60_000);
    expect(await auth.authenticate(token)).not.toBeNull(); // day 12, still inside seven days of the day-6 use
    advance(8 * 24 * 60 * 60_000);
    expect(await auth.authenticate(token)).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it('a session that is never used stops working after seven days', async () => {
    advance(7 * 24 * 60 * 60_000 + 1);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('end when the account is disabled', async () => {
    store.accounts.get(1)!.disabled = true;
    expect(await auth.authenticate(token)).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it('expired ones are purged in bulk', async () => {
    await auth.register({ username: 'bob', password: GOOD }, ctx('t'));
    advance(8 * 24 * 60 * 60_000);
    expect(await auth.purgeExpired()).toBe(2);
  });
});

describe('changing your password', () => {
  it('needs the current one, a good new one, and ends the other sessions but not this one', async () => {
    const first = await auth.register({ username: 'ana', password: GOOD }, ctx('1'));
    const other = await auth.login({ username: 'ana', password: GOOD }, ctx('2'));
    const account = (await auth.authenticate(first.token))!;
    expect(await code(auth.changePassword(account, first.token, 'wrong-wrong-1', 'a-new-password-1'))).toBe('invalid');
    expect(await code(auth.changePassword(account, first.token, GOOD, 'short'))).toBe('weak');
    expect(await code(auth.changePassword(account, first.token, GOOD, GOOD))).toBe('weak');
    await auth.changePassword(account, first.token, GOOD, 'a-new-password-1');
    expect(await auth.authenticate(first.token)).not.toBeNull();
    expect(await auth.authenticate(other.token)).toBeNull();
    expect(await code(auth.login({ username: 'ana', password: GOOD }, ctx('3')))).toBe('invalid');
    expect(await code(auth.login({ username: 'ana', password: 'a-new-password-1' }, ctx('4')))).toBe('ok');
  });
});

describe('the first admin', () => {
  it('is created from the environment only when there is none', async () => {
    expect(await auth.bootstrapAdmin(undefined, undefined)).toBe('not configured');
    expect(await auth.bootstrapAdmin('boss', undefined)).toBe('not configured');
    expect(await auth.bootstrapAdmin('boss', GOOD)).toBe('created');
    expect([...store.accounts.values()][0]).toMatchObject({ username: 'boss', role: 'admin' });
    expect(await auth.bootstrapAdmin('boss2', GOOD)).toBe('exists');
    expect(store.accounts.size).toBe(1);
  });
  it('is refused when the password is weak or the name is invalid or already a player', async () => {
    expect(await auth.bootstrapAdmin('boss', 'short')).toBe('refused');
    expect(await auth.bootstrapAdmin('b', GOOD)).toBe('refused');
    await auth.register({ username: 'taken', password: GOOD }, ctx());
    expect(await auth.bootstrapAdmin('Taken', GOOD)).toBe('refused');
    expect(await store.countAdmins()).toBe(0);
  });
  it('can log in', async () => {
    await auth.bootstrapAdmin('boss', GOOD);
    const { account } = await auth.login({ username: 'boss', password: GOOD }, ctx());
    expect(account.role).toBe('admin');
  });
  it('may use a name players cannot (admin)', async () => {
    expect(await auth.bootstrapAdmin('admin', GOOD)).toBe('created');
  });
});

describe('RateLimiter', () => {
  it('allows the limit, then refuses until the window passes, per key', () => {
    let t = 0;
    const r = new RateLimiter(3, 1000, () => t);
    expect([r.allow('a'), r.allow('a'), r.allow('a'), r.allow('a')]).toEqual([true, true, true, false]);
    expect(r.allow('b')).toBe(true);
    t = 999; expect(r.allow('a')).toBe(false);
    t = 1001; expect(r.allow('a')).toBe(true);
  });
  it('wouldAllow records nothing and reset forgets a key', () => {
    const r = new RateLimiter(1, 1000, () => 0);
    expect(r.wouldAllow('k')).toBe(true); expect(r.wouldAllow('k')).toBe(true);
    r.allow('k');
    expect(r.wouldAllow('k')).toBe(false);
    r.reset('k');
    expect(r.wouldAllow('k')).toBe(true);
  });
  it('does not grow without bound', () => {
    let t = 0;
    const r = new RateLimiter(1, 10, () => t);
    for (let i = 0; i < 6000; i++) { r.allow('k' + i); t += 20; }
    expect((r as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThan(5100);
  });
});

describe('hostile input to login', () => {
  beforeEach(async () => { await auth.register({ username: 'ana', password: GOOD }, ctx('setup')); });

  it('names that cannot be real (too long, control characters, NUL) are refused cheaply and never reach the database', async () => {
    let touched = 0;
    const spy = store.byLower.bind(store);
    store.byLower = async l => { touched++; return spy(l); };
    for (const name of ['x'.repeat(65), 'x'.repeat(100000), 'ana\u0000', '\u0000', 'an\na', 'ana\u007f', 'a\tb']) {
      expect(await code(auth.login({ username: name, password: GOOD }, ctx('h'))), JSON.stringify(name).slice(0, 30)).toBe('invalid');
    }
    expect(touched).toBe(0);
  });
});

describe('hostile input to password change', () => {
  it('guessing the current password with a stolen session is limited to five tries', async () => {
    const { token } = await auth.register({ username: 'ana', password: GOOD }, ctx('1'));
    const account = (await auth.authenticate(token))!;
    for (let i = 0; i < 5; i++) expect(await code(auth.changePassword(account, token, 'guess-' + i + '-xxxx', 'a-new-password-1'))).toBe('invalid');
    expect(await code(auth.changePassword(account, token, GOOD, 'a-new-password-1'))).toBe('rate');
    advance(15 * 60_000 + 1000);
    expect(await code(auth.changePassword(account, token, GOOD, 'a-new-password-1'))).toBe('ok');
  });
  it('an absurdly long current password is just wrong', async () => {
    const { token } = await auth.register({ username: 'ana', password: GOOD }, ctx('1'));
    const account = (await auth.authenticate(token))!;
    expect(await code(auth.changePassword(account, token, 'x'.repeat(100000), 'a-new-password-1'))).toBe('invalid');
  });
});

describe('session lifetime', () => {
  it('can be renewed again and again while used, but never lives past thirty days', async () => {
    const { token } = await auth.register({ username: 'ana', password: GOOD }, ctx('1'));
    for (let day = 1; day <= 29; day++) { advance(24 * 60 * 60_000); expect(await auth.authenticate(token), 'day ' + day).not.toBeNull(); }
    advance(2 * 24 * 60 * 60_000);
    expect(await auth.authenticate(token)).toBeNull(); // day 31: used daily, still over the limit
  });
});
