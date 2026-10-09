import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSeed } from '@office/shared';
import { TicketService } from '../auth/tickets';
import { GameGateway } from './game.gateway';
import {
  PASSWORD, api, bootTestServer, connect, enter, hello, isKick, isSnapshot, isWelcome, sessionFor, sleep, ticketFor, type TestServer,
} from '../test-support';

// Who may open the realtime connection: only a logged-in account, with a one-time ticket, one connection each.

process.env.WORLD_SEED = '1';
process.env.HELLO_TIMEOUT_MS = '600';
process.env.MAX_UNJOINED_PER_ADDRESS = '3';

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
const client = () => { const c = connect(base); open.push(c.socket); return c; };

beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); });

describe('the ticket endpoint', () => {
  it('needs a logged-in session', async () => {
    expect((await api(base, 'POST', '/api/play/ticket')).status).toBe(401);
    expect((await api(base, 'POST', '/api/play/ticket', undefined, { cookie: 'office_session=nope' })).status).toBe(401);
  });

  it('gives a one-time ticket to a logged-in account', async () => {
    const cookie = await sessionFor(base, 'tick1');
    const r = await api(base, 'POST', '/api/play/ticket', undefined, { cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ expiresInMs: 30000 });
    expect(r.body.ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(r.body)).not.toContain(cookie.split('=')[1]); // the session secret is never echoed
  });

  it('refuses a request that came from another site', async () => {
    const cookie = await sessionFor(base, 'tick2');
    expect((await api(base, 'POST', '/api/play/ticket', undefined, { cookie, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('is limited to ten a minute per account', async () => {
    const cookie = await sessionFor(base, 'tick3');
    for (let i = 0; i < 10; i++) expect((await api(base, 'POST', '/api/play/ticket', undefined, { cookie })).status).toBe(200);
    const r = await api(base, 'POST', '/api/play/ticket', undefined, { cookie });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate');
  });
});

describe('opening the connection', () => {
  it('a ticket gets you in, and you are known by account on the server', async () => {
    const a = client(); await a.ready;
    await enter(base, a, 'alice');
    expect(await a.waitFor(isWelcome)).toBeTruthy();
    expect(server.app.get(GameGateway).connectedAccounts).toBeGreaterThanOrEqual(1);
    a.socket.close();
  });

  it('no ticket, an empty one, a made-up one, or an oversized one: kicked, and no snapshots', async () => {
    for (const ticket of ['', 'not-a-ticket', 'x'.repeat(100), 'A'.repeat(32)]) {
      const c = client(); await c.ready;
      hello(c, ticket);
      expect((await c.waitFor(isKick)).reason).toMatch(/ticket/);
      await c.disconnected;
      expect(c.messages.some(isWelcome) || c.messages.some(isSnapshot)).toBe(false);
    }
  });

  it('a ticket works once: a second connection with it is refused', async () => {
    const cookie = await sessionFor(base, 'once');
    const ticket = await ticketFor(base, cookie);
    const first = client(); await first.ready; hello(first, ticket);
    await first.waitFor(isWelcome);
    const second = client(); await second.ready; hello(second, ticket);
    expect((await second.waitFor(isKick)).reason).toMatch(/ticket/);
    first.socket.close();
  });

  it('an expired ticket is refused', async () => {
    const cookie = await sessionFor(base, 'slow');
    const ticket = await ticketFor(base, cookie);
    const tickets = server.app.get(TicketService) as unknown as { now: () => number };
    const real = tickets.now;
    tickets.now = () => Date.now() + 31_000; // thirty-one seconds later
    const c = client(); await c.ready; hello(c, ticket);
    expect((await c.waitFor(isKick)).reason).toMatch(/ticket/);
    tickets.now = real;
  });

  it('a ticket asked for by a session that then logged out is refused', async () => {
    const cookie = await sessionFor(base, 'quitter');
    const ticket = await ticketFor(base, cookie);
    await api(base, 'POST', '/api/auth/logout', undefined, { cookie });
    const c = client(); await c.ready; hello(c, ticket);
    expect((await c.waitFor(isKick)).reason).toMatch(/session/);
  });

  it('a disabled account cannot join even with a valid ticket', async () => {
    const cookie = await sessionFor(base, 'banned');
    const ticket = await ticketFor(base, cookie);
    const acc = [...server.store.accounts.values()].find(a => a.username === 'banned')!;
    acc.disabled = true;
    const c = client(); await c.ready; hello(c, ticket);
    expect((await c.waitFor(isKick)).reason).toMatch(/session|allowed/);
    acc.disabled = false;
  });

  it('saying hello twice does nothing the second time', async () => {
    const c = client(); await c.ready;
    const cookie = await enter(base, c, 'twice');
    await c.waitFor(isWelcome);
    hello(c, await ticketFor(base, cookie));
    await sleep(300);
    expect(c.messages.filter(isWelcome)).toHaveLength(1);
    expect(c.messages.some(isKick)).toBe(false);
    c.socket.close();
  });

  it('hello with the wrong kind of data is bad input, not a crash', async () => {
    const c = client(); await c.ready;
    c.socket.emit('m', new Uint8Array([0x01, 3, 0xff, 0xff])); // a hello whose ticket claims 65535 bytes
    expect((await c.waitFor(isKick)).reason).toMatch(/bad message/);
  });
});

describe('one connection per account', () => {
  it('a second login takes over and the first is told why', async () => {
    const cookie = await sessionFor(base, 'twin');
    const first = client(); await first.ready; hello(first, await ticketFor(base, cookie));
    await first.waitFor(isWelcome);
    const second = client(); await second.ready; hello(second, await ticketFor(base, cookie));
    expect((await first.waitFor(isKick)).reason).toMatch(/somewhere else/);
    await first.disconnected;
    expect(await second.waitFor(isWelcome)).toBeTruthy();
    await sleep(300);
    expect(second.messages.filter(isSnapshot).length).toBeGreaterThan(3); // the newcomer keeps getting the world
    second.socket.close();
  });

  it('different accounts do not disturb each other', async () => {
    const a = client(), b = client();
    await Promise.all([a.ready, b.ready]);
    await enter(base, a, 'peer1'); await enter(base, b, 'peer2');
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    await sleep(300);
    expect(a.messages.some(isKick) || b.messages.some(isKick)).toBe(false);
    a.socket.close(); b.socket.close();
  });
});

describe('ending a session ends its connection', () => {
  it('logging out drops the connection, and only that account', async () => {
    const a = client(), b = client();
    await Promise.all([a.ready, b.ready]);
    const cookieA = await enter(base, a, 'leaver'); await enter(base, b, 'stayer');
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    await api(base, 'POST', '/api/auth/logout', undefined, { cookie: cookieA });
    expect((await a.waitFor(isKick)).reason).toMatch(/logged out/);
    await sleep(300);
    expect(b.messages.some(isKick)).toBe(false);
    b.socket.close();
  });

  it('changing the password drops the connections of the other sessions, not the one you changed it from', async () => {
    const cookie1 = await sessionFor(base, 'changer');
    const login = await api(base, 'POST', '/api/auth/login', { username: 'changer', password: PASSWORD });
    const cookie2 = login.setCookie!.split(';')[0];
    const onSecond = client(); await onSecond.ready; hello(onSecond, await ticketFor(base, cookie2));
    await onSecond.waitFor(isWelcome);
    await api(base, 'POST', '/api/auth/password', { current: PASSWORD, next: 'a-different-pass-9' }, { cookie: cookie1 });
    expect((await onSecond.waitFor(isKick)).reason).toMatch(/logged out/);

    const onFirst = client(); await onFirst.ready; hello(onFirst, await ticketFor(base, cookie1));
    await onFirst.waitFor(isWelcome);
    await api(base, 'POST', '/api/auth/password', { current: 'a-different-pass-9', next: 'yet-another-pass-77' }, { cookie: cookie1 });
    await sleep(300);
    expect(onFirst.messages.some(isKick)).toBe(false); // the session that changed it stays
    onFirst.socket.close();
  });
});

describe('races and long-lived connections', () => {
  it('a logout that lands while the connection is still being admitted still ends it', async () => {
    const cookie = await sessionFor(base, 'racer');
    const ticket = await ticketFor(base, cookie);
    const real = server.auth.sessionAlive.bind(server.auth);
    server.auth.sessionAlive = async h => { await sleep(300); return real(h); }; // the check takes a moment
    const c = client(); await c.ready; hello(c, ticket);
    await sleep(100);
    await api(base, 'POST', '/api/auth/logout', undefined, { cookie }); // lands in the middle
    const k = await c.waitFor(isKick, 2000);
    server.auth.sessionAlive = real;
    expect(k.reason).toMatch(/logged out|session/);
    expect(c.messages.some(isWelcome)).toBe(false);
    expect(c.messages.some(isSnapshot)).toBe(false);
  });

  it('the periodic check drops a connection whose session has expired, and one whose account was disabled', async () => {
    const gateway = server.app.get(GameGateway);
    const a = client(), b = client(), keep = client();
    await Promise.all([a.ready, b.ready, keep.ready]);
    await enter(base, a, 'expiring'); await enter(base, b, 'disabled_later'); await enter(base, keep, 'fine');
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome), keep.waitFor(isWelcome)]);
    expect(await gateway.sweep()).toBe(0); // nothing wrong yet
    const idOf = (name: string) => [...server.store.accounts.values()].find(x => x.username === name)!.id;
    for (const s of server.store.sessions.values()) if (s.info.accountId === idOf('expiring')) s.info.expiresAt = new Date(Date.now() - 1000);
    server.store.accounts.get(idOf('disabled_later'))!.disabled = true;
    expect(await gateway.sweep()).toBe(2);
    expect((await a.waitFor(isKick)).reason).toMatch(/session has ended/);
    expect((await b.waitFor(isKick)).reason).toMatch(/session has ended/);
    await sleep(200);
    expect(keep.messages.some(isKick)).toBe(false);
    keep.socket.close();
    server.store.accounts.get(idOf('disabled_later'))!.disabled = false;
  });

  it('ending every session of an account drops its connection too', async () => {
    const c = client(); await c.ready;
    await enter(base, c, 'everything');
    await c.waitFor(isWelcome);
    const id = [...server.store.accounts.values()].find(x => x.username === 'everything')!.id;
    await server.auth.endAllSessions(id);
    expect((await c.waitFor(isKick)).reason).toMatch(/logged out/);
  });

  it('a flood of silent connections from one address is cut off at a small number', async () => {
    const silent = Array.from({ length: 6 }, () => client());
    const results = await Promise.all(silent.map(c => c.waitFor(isKick, 1500).then(k => k.reason, () => 'waiting')));
    expect(results.filter(r => /too many connections/.test(r)).length).toBeGreaterThanOrEqual(2);
    silent.forEach(c => c.socket.close());
    await sleep(200);
  });

  it('connections that have said hello do not count against that limit (people arriving one after another all get in)', async () => {
    const members: ReturnType<typeof client>[] = [];
    for (let i = 0; i < 6; i++) {
      const c = client(); members.push(c);
      await c.ready; await enter(base, c, 'member' + i); await c.waitFor(isWelcome); // joined before the next one connects
    }
    expect(members.every(c => !c.messages.some(isKick))).toBe(true); // six joined from one address with a limit of three waiting at once
    members.forEach(c => c.socket.close());
  });
});

describe('without accounts', () => {
  it('the gateway says so instead of letting anyone in', async () => {
    const lonely = await (async () => {
      const { NestFactory } = await import('@nestjs/core');
      const { AppModule } = await import('../app.module');
      const { configureApp } = await import('../app.config');
      const app = await NestFactory.create(AppModule, { logger: false });
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
    })();
    const c = connect(lonely.base); await c.ready;
    hello(c, 'whatever');
    expect((await c.waitFor(isKick)).reason).toMatch(/accounts are not available/);
    c.socket.close();
    await lonely.app.close();
  });
});
