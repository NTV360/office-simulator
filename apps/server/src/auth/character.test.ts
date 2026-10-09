import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, PARTS, normalizePlayerSpec, people, setSeed, type Message } from '@office/shared';
import { api, bootTestServer, connect, enter, isWelcome, sessionFor, sleep, type Client, type TestServer } from '../test-support';

// Character creation over HTTP: your own look only, always made valid, shown to everyone at once.

process.env.WORLD_SEED = '1';
process.env.ADMIN_TOKEN = 'char-test-token';

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

const get = (cookie: string) => api(base, 'GET', '/api/character', undefined, { cookie });
const put = (cookie: string, spec: unknown, headers: Record<string, string> = {}) => api(base, 'PUT', '/api/character', { spec }, { cookie, ...headers });
const admin = (method: string, path: string, body?: unknown) => api(base, method, path, body, { authorization: 'Bearer char-test-token' });
const accountIdOf = async (name: string): Promise<number> => (await admin('GET', '/api/admin/users')).body.find((u: { username: string }) => u.username === name).id;

const NICE = { ...DEFAULT_SPEC, skin: PARTS.skin[0], hair: PARTS.hair[4], style: 'bun', shirt: PARTS.shirt[3], glasses: true, headphones: PARTS.headphones[2], jacket: PARTS.jacket[1], longSleeve: true, scale: 1.05 };

describe('reading and saving a look', () => {
  it('starts with no look and a valid starting point', async () => {
    const cookie = await sessionFor(base, 'newcomer');
    const r = await get(cookie);
    expect(r.status).toBe(200);
    expect(r.body.spec).toBeNull();
    expect(r.body.starting).toEqual(normalizePlayerSpec(DEFAULT_SPEC));
    expect((await api(base, 'GET', '/api/auth/me', undefined, { cookie })).body.account.hasLook).toBe(false);
  });

  it('saves a look, gives it back, and the account says it has one', async () => {
    const cookie = await sessionFor(base, 'saver');
    const r = await put(cookie, NICE);
    expect(r.status).toBe(200);
    expect(r.body.spec).toEqual(NICE);
    expect((await get(cookie)).body.spec).toEqual(NICE);
    expect((await api(base, 'GET', '/api/auth/me', undefined, { cookie })).body.account.hasLook).toBe(true);
    const stored = (await server.store.byLower('saver'))!;
    expect(stored.spec).toEqual(NICE);
  });

  it('whatever is sent becomes a valid look: bad colours, styles and heights fall back or are held in range', async () => {
    const cookie = await sessionFor(base, 'sloppy');
    const r = await put(cookie, { skin: 'red', hair: '#12345', shirt: '<script>alert(1)</script>', style: 'mohawk', scale: 99, glasses: 'yes', headphones: 'url(x)', jacket: 5, pants: null });
    expect(r.status).toBe(200);
    expect(r.body.spec).toMatchObject({
      skin: DEFAULT_SPEC.skin, hair: DEFAULT_SPEC.hair, shirt: DEFAULT_SPEC.shirt, pants: DEFAULT_SPEC.pants, style: DEFAULT_SPEC.style,
      scale: 1.1, glasses: true, headphones: null, jacket: null,
    });
    expect((await put(cookie, { scale: -5 })).body.spec.scale).toBe(0.9);
    expect((await put(cookie, { scale: 'tall' })).body.spec.scale).toBe(1);
    expect((await put(cookie, { scale: NaN })).body.spec.scale).toBe(1);
  });

  it('the looks that belong to Hazel cannot be chosen', async () => {
    const cookie = await sessionFor(base, 'wannabe');
    const r = await put(cookie, { ...NICE, skirt: '#ff00ff', cube: true, angry: true });
    expect(r.body.spec).toMatchObject({ skirt: null, cube: false, angry: false });
    expect((await get(cookie)).body.spec).toMatchObject({ skirt: null, cube: false, angry: false });
  });

  it('refuses a body that is not a look', async () => {
    const cookie = await sessionFor(base, 'oddbody');
    for (const bad of [undefined, null, 'dark hair', 5, [1, 2], true]) {
      expect((await put(cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await api(base, 'PUT', '/api/character', undefined, { cookie })).status).toBe(400);
    expect((await api(base, 'PUT', '/api/character', { skin: '#ffffff' }, { cookie })).status).toBe(400); // (the look must be inside "spec")
    expect((await get(cookie)).body.spec).toBeNull(); // nothing was saved
  });

  it('prototype tricks and extra fields do nothing', async () => {
    const cookie = await sessionFor(base, 'sneaky');
    const r = await api(base, 'PUT', '/api/character', JSON.parse('{"spec":{"__proto__":{"scale":9},"constructor":{"x":1},"role":"admin","owner":1,"extra":"x"}}'), { cookie });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.spec).sort()).toEqual(Object.keys(normalizePlayerSpec({})).sort());
    expect(({} as { scale?: number }).scale).toBeUndefined();
    expect((await server.store.byLower('sneaky'))!.role).toBe('player');
  });
});

describe('who may', () => {
  it('needs a login', async () => {
    expect((await api(base, 'GET', '/api/character')).status).toBe(401);
    expect((await api(base, 'PUT', '/api/character', { spec: NICE })).status).toBe(401);
    expect((await api(base, 'PUT', '/api/character', { spec: NICE }, { cookie: 'office_session=nonsense' })).status).toBe(401);
  });

  it('a request from another site is refused, and so is anything but JSON', async () => {
    const cookie = await sessionFor(base, 'framed');
    expect((await put(cookie, NICE, { origin: 'https://evil.example' })).status).toBe(403);
    const form = await fetch(base + '/api/character', { method: 'PUT', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: 'spec=1' });
    expect(form.status).toBe(415);
    expect((await get(cookie)).body.spec).toBeNull();
  });

  it('an account an admin has just made must choose its password before anything else', async () => {
    await server.auth.createAccount({ username: 'fresh', password: 'first-password-1', mustChange: true });
    const login = await api(base, 'POST', '/api/auth/login', { username: 'fresh', password: 'first-password-1' });
    const cookie = login.setCookie!.split(';')[0];
    const r = await put(cookie, NICE);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('must-change-password');
    expect((await get(cookie)).status).toBe(403);
    expect((await server.store.byLower('fresh'))!.spec).toBeNull();
  });

  it('is limited: ten changes a minute', async () => {
    const cookie = await sessionFor(base, 'fidget');
    for (let i = 0; i < 10; i++) expect((await put(cookie, { ...NICE, scale: 0.9 + i / 100 })).status).toBe(200);
    const r = await put(cookie, NICE);
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate');
    expect((await get(cookie)).status).toBe(200); // reading is not limited
  });

  it('you can only change your own: nothing in the request names an account', async () => {
    const a = await sessionFor(base, 'ownerA'), b = await sessionFor(base, 'ownerB');
    await put(a, { ...NICE, shirt: PARTS.shirt[1] });
    await put(b, { ...NICE, shirt: PARTS.shirt[5] });
    expect((await get(a)).body.spec.shirt).toBe(PARTS.shirt[1]);
    expect((await get(b)).body.spec.shirt).toBe(PARTS.shirt[5]);
    const sneaky = await api(base, 'PUT', '/api/character', { spec: { ...NICE, shirt: PARTS.shirt[2] }, accountId: await accountIdOf('ownerA'), id: 1 }, { cookie: b });
    expect(sneaky.status).toBe(200);
    expect((await get(a)).body.spec.shirt).toBe(PARTS.shirt[1]); // unchanged
    expect((await get(b)).body.spec.shirt).toBe(PARTS.shirt[2]);
  });
});

describe('everyone sees it at once', () => {
  const client = (): Client => { const c = connect(base); open.push(c.socket); return c; };
  const lastInfo = (c: Client, id: number) => [...c.messages].reverse().find((m): m is Extract<Message, { type: 'person' }> => m.type === 'person' && m.info.id === id)?.info;

  it('a player who is playing changes look: the player and every viewer get the new look without reconnecting', async () => {
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'viewer1');
    await watcher.waitFor(isWelcome);
    const me = client(); await me.ready; await enter(base, me, 'stylist');
    const w = await me.waitFor(isWelcome);
    const cookie = await sessionFor(base, 'stylist');
    expect((await put(cookie, NICE)).status).toBe(200);
    await sleep(400);
    expect(lastInfo(watcher, w.you)?.spec).toEqual(NICE);
    expect(lastInfo(me, w.you)?.spec).toEqual(NICE);
    expect(people.find(p => p.id === w.you)!.spec).toEqual(NICE);
    // and it is the same person, still the same player
    expect(lastInfo(watcher, w.you)).toMatchObject({ name: 'stylist', controller: 'account' });
    me.socket.close(); watcher.socket.close();
  });

  it('a look saved before logging in is the look they arrive with', async () => {
    const cookie = await sessionFor(base, 'prepared');
    await put(cookie, { ...NICE, hair: PARTS.hair[6] });
    const c = client(); await c.ready; await enter(base, c, 'prepared');
    const w = await c.waitFor(isWelcome);
    expect(w.people.find(p => p.info.id === w.you)!.info.spec).toMatchObject({ hair: PARTS.hair[6], style: 'bun' });
    c.socket.close();
  });

  it('an account with a desk who is not playing: their person on autopilot changes look too', async () => {
    const cookie = await sessionFor(base, 'deskstylist');
    const slots = (await admin('GET', '/api/admin/slots')).body as Array<{ spot: string; status: string }>;
    const desk = slots.find(s => s.status === 'unclaimed')!.spot;
    expect((await admin('POST', `/api/admin/users/${await accountIdOf('deskstylist')}/assign-slot`, { spot: desk })).status).toBe(201);
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'viewer2');
    const w0 = await watcher.waitFor(isWelcome);
    const person = w0.people.find(p => p.info.name === 'deskstylist')!;
    expect(person.info.controller).toBe('ai');
    expect((await put(cookie, NICE)).status).toBe(200);
    await sleep(400);
    expect(lastInfo(watcher, person.info.id)?.spec).toEqual(NICE);
    expect(lastInfo(watcher, person.info.id)).toMatchObject({ name: 'deskstylist', controller: 'ai' });
    watcher.socket.close();
  });
});
