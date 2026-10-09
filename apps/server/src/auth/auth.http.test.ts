import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { MemoryAccountStore } from './account-store';
import { AuthProvider } from './auth.provider';
import { AuthService } from './auth.service';

// The real HTTP layer (cookies, guards, error answers) over an in-memory store. The database store has its own tests.

delete process.env.DATABASE_URL;
process.env.WORLD_SEED = '1';

const GOOD = 'correct-horse-battery';
let app: INestApplication;
let base: string;
let store: MemoryAccountStore;

async function boot(env: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  store = new MemoryAccountStore();
  app.get(AuthProvider).useService(new AuthService(store, { signupCode: process.env.SIGNUP_CODE || undefined }));
}
beforeEach(async () => { await boot(); });
afterEach(async () => { await app.close(); for (const k of ['SIGNUP_CODE', 'COOKIE_SECURE', 'TRUST_PROXY']) delete process.env[k]; });

interface Reply { status: number; body: any; setCookie: string | null; cookie: string | null } // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => null), setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
}
const register = (username = 'ana', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => call('POST', '/api/auth/register', { username, password: GOOD, ...extra }, headers);

describe('register and the cookie', () => {
  it('creates the account and logs in with a safe cookie', async () => {
    const r = await register('Ana');
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ account: { id: 1, username: 'Ana', role: 'player', slotSpot: null, hasLook: false, mustChangePassword: false } });
    expect(r.setCookie).toMatch(/^office_session=[A-Za-z0-9_-]{43};/);
    expect(r.setCookie).toContain('HttpOnly');
    expect(r.setCookie).toContain('SameSite=Strict');
    expect(r.setCookie).toContain('Path=/');
    expect(r.setCookie).toContain('Max-Age=2592000');
    expect(r.setCookie).not.toContain('Secure'); // plain http on the local network
  });

  it('the cookie is marked Secure when asked to be, or when a trusted proxy says the page is https', async () => {
    await app.close(); await boot({ COOKIE_SECURE: 'true' });
    expect((await register('ana')).setCookie).toContain('Secure');
    await app.close(); delete process.env.COOKIE_SECURE; await boot({ TRUST_PROXY: '1' });
    expect((await register('bob', {}, { 'x-forwarded-proto': 'https' })).setCookie).toContain('Secure');
    expect((await register('cat')).setCookie).not.toContain('Secure');
  });

  it('answers 400 with the reason for a bad username or password, 409 for a taken one', async () => {
    expect((await register('a')).body).toMatchObject({ statusCode: 400, code: 'username' });
    expect((await call('POST', '/api/auth/register', { username: 'ana', password: 'short' })).body).toMatchObject({ statusCode: 400, code: 'weak' });
    await register('ana');
    const dup = await register('ANA', {}, {});
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'taken' });
    expect(dup.setCookie).toBeNull();
  });

  it('the sign-up code, when set, is required', async () => {
    await app.close(); await boot({ SIGNUP_CODE: 'office-2026' });
    expect((await register('ana')).status).toBe(403);
    expect((await register('ana', { signupCode: 'office-2026' })).status).toBe(201);
  });

  it('survives missing and malformed bodies', async () => {
    expect((await call('POST', '/api/auth/register')).status).toBe(400);
    const raw = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(raw.status).toBe(400);
    const form = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=ana&password=' + GOOD });
    expect(form.status).toBe(415); // a form post is not accepted as a registration
    const text = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ username: 'ana', password: GOOD }) });
    expect(text.status).toBe(415);
    expect(store.accounts.size).toBe(0);
    expect((await call('POST', '/api/auth/login', [1, 2, 3])).status).toBe(401);
  });
});

describe('login, me, logout', () => {
  it('login sets a cookie that opens /me; logout ends it', async () => {
    await register('ana');
    const login = await call('POST', '/api/auth/login', { username: 'Ana', password: GOOD });
    expect(login.status).toBe(200);
    const me = await call('GET', '/api/auth/me', undefined, { cookie: login.cookie! });
    expect(me.status).toBe(200);
    expect(me.body.account.username).toBe('ana');
    const out = await call('POST', '/api/auth/logout', undefined, { cookie: login.cookie! });
    expect(out.status).toBe(200);
    expect(out.setCookie).toContain('Max-Age=0');
    expect((await call('GET', '/api/auth/me', undefined, { cookie: login.cookie! })).status).toBe(401);
  });

  it('/me without a cookie, with a wrong one or with someone elses mangled one is 401', async () => {
    const { cookie } = await register('ana');
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: 'office_session=nope' })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: cookie! + 'x' })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: 'other=1; ' + cookie! })).status).toBe(200); // among other cookies
  });

  it('wrong password and unknown name look the same on the wire', async () => {
    await register('ana');
    const a = await call('POST', '/api/auth/login', { username: 'ana', password: 'wrong-wrong-1' });
    const b = await call('POST', '/api/auth/login', { username: 'nobody', password: 'wrong-wrong-1' });
    expect([a.status, a.body]).toEqual([b.status, b.body]);
    expect(a.status).toBe(401);
    expect(a.setCookie).toBeNull();
  });

  it('too many wrong passwords answer 429', async () => {
    await register('ana');
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { username: 'ana', password: `wrong-${i}-xxxx` });
    // (all from the same address here)
    const locked = await call('POST', '/api/auth/login', { username: 'ana', password: GOOD });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('rate');
  });

  it('changing the password over HTTP ends the other sessions', async () => {
    const a = await register('ana');
    const b = await call('POST', '/api/auth/login', { username: 'ana', password: GOOD });
    expect((await call('POST', '/api/auth/password', { current: GOOD, next: 'brand-new-pass-1' }, { cookie: a.cookie! })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: a.cookie! })).status).toBe(200);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: b.cookie! })).status).toBe(401);
    expect((await call('POST', '/api/auth/password', { current: 'wrong-wrong-1', next: 'another-pass-123' }, { cookie: a.cookie! })).status).toBe(401);
    expect((await call('POST', '/api/auth/password', { current: 'brand-new-pass-1', next: 'x' }, { cookie: a.cookie! })).status).toBe(400);
    expect((await call('POST', '/api/auth/password', { current: GOOD, next: 'another-pass-123' })).status).toBe(401); // not logged in
  });
});

describe('requests from other sites', () => {
  it('a state-changing request whose Origin is another site is refused, even with a valid cookie', async () => {
    const { cookie } = await register('ana');
    const evil = { origin: 'https://evil.example', cookie: cookie! };
    expect((await call('POST', '/api/auth/logout', undefined, evil)).status).toBe(403);
    expect((await call('POST', '/api/auth/login', { username: 'ana', password: GOOD }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/auth/register', { username: 'zed', password: GOOD }, { origin: 'http://evil.example:80' })).status).toBe(403);
    expect((await call('GET', '/api/auth/me', undefined, { cookie: cookie! })).status).toBe(200); // the session is still alive: it was never used
  });
  it('the page own origin is fine, a junk Origin is not', async () => {
    const host = new URL(base).host;
    expect((await register('ana', {}, { origin: `http://${host}` })).status).toBe(201);
    expect((await call('POST', '/api/auth/login', { username: 'ana', password: GOOD }, { origin: 'not a url' })).status).toBe(403);
  });
});

describe('nothing secret leaks', () => {
  it('no response contains the password, a hash, or the session token other than in Set-Cookie', async () => {
    const r = await register('ana');
    const token = r.cookie!.split('=')[1];
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(GOOD); expect(text).not.toContain('argon2'); expect(text).not.toContain(token);
    const me = JSON.stringify((await call('GET', '/api/auth/me', undefined, { cookie: r.cookie! })).body);
    expect(me).not.toContain('argon2'); expect(me).not.toContain(token);
  });

  it('the password and session are not written to the log, including when something fails', async () => {
    const lines: string[] = [];
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(Logger.prototype, 'log'), vi.spyOn(Logger.prototype, 'error'), vi.spyOn(Logger.prototype, 'warn')];
    spies.forEach(s => s.mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    const secret = 'Zx9-very-secret-pass';
    const r = await call('POST', '/api/auth/register', { username: 'ana', password: secret });
    await call('POST', '/api/auth/login', { username: 'ana', password: secret + 'wrong' });
    await call('POST', '/api/auth/register', { username: 'ana', password: secret });
    const token = r.cookie!.split('=')[1];
    spies.forEach(s => s.mockRestore());
    const all = lines.join('\n');
    expect(all).not.toContain(secret); expect(all).not.toContain(token);
  });
});

describe('without a database', () => {
  it('accounts answer 503 rather than pretending', async () => {
    await app.close();
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    expect((await register('ana')).status).toBe(503);
    expect((await call('GET', '/api/auth/me')).status).toBe(503);
  });
});

describe('hostile cookies', () => {
  it('a cookie that is not valid percent-encoding is just not a session (401, not a crash)', async () => {
    for (const c of ['office_session=%E0%A4%A', 'office_session=%', '=; ;;', 'office_session', 'a=b; office_session=%zz']) {
      expect((await call('GET', '/api/auth/me', undefined, { cookie: c })).status, c).toBe(401);
    }
    expect((await call('GET', '/api/health')).status).toBe(200); // and the server is still up
  });
});
