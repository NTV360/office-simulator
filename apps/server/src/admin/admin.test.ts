import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, decode, encode, hasSlot, people, setSeed, sim, type Message } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { parseSettingsUpdate } from './settings';

process.env.WORLD_SEED = '1';
delete process.env.DATABASE_URL;

let app: INestApplication;
let base: string;
const TOKEN = 'test-token-123';

async function boot() {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}
beforeEach(async () => { process.env.ADMIN_TOKEN = TOKEN; await boot(); });
afterEach(async () => { await app.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

// (the response body is read as loosely typed JSON)
const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, json: () => r.json() as Promise<any> };
};
const world = async () => (await fetch(base + '/api/world')).json() as Promise<{ staff: number; speed: number; paused: boolean; simTime: number }>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('who may use the admin API', () => {
  it('does not exist without ADMIN_TOKEN', async () => {
    await app.close();
    delete process.env.ADMIN_TOKEN;
    await boot();
    expect((await call('GET', '/api/admin/settings')).status).toBe(404);
  });
  it('refuses a missing, wrong or malformed token, and accepts the right one', async () => {
    expect((await call('GET', '/api/admin/settings', undefined, null)).status).toBe(403);
    expect((await call('GET', '/api/admin/settings', undefined, 'wrong')).status).toBe(403);
    expect((await call('GET', '/api/admin/settings', undefined, TOKEN + 'x')).status).toBe(403);
    expect((await fetch(base + '/api/admin/settings', { headers: { authorization: TOKEN } })).status).toBe(403); // no "Bearer"
    expect((await call('GET', '/api/admin/settings')).status).toBe(200);
  });
  it('locks out an address after ten failures', async () => {
    for (let i = 0; i < 10; i++) expect((await call('GET', '/api/admin/settings', undefined, 'nope' + i)).status).toBe(403);
    expect((await call('GET', '/api/admin/settings', undefined, 'nope')).status).toBe(429);
    expect((await call('GET', '/api/admin/settings')).status).toBe(429); // even the right token, for a while
  });
  it('the public world page needs no token', async () => {
    expect((await fetch(base + '/api/world')).status).toBe(200);
  });
});

describe('changing settings', () => {
  it('reports the current settings', async () => {
    expect(await (await call('GET', '/api/admin/settings')).json()).toEqual({ slots: 40, maxSlots: 70, speed: 1, paused: false, tickRate: 20 });
  });

  it('slots: add and remove staff, never beyond the desks', async () => {
    let r = await call('PUT', '/api/admin/settings', { slots: 55 });
    expect((await r.json()).slots).toBe(55);
    expect((await world()).staff).toBe(55);
    expect(people.filter(hasSlot)).toHaveLength(55);
    r = await call('PUT', '/api/admin/settings', { slots: 12 });
    expect((await r.json()).slots).toBe(12);
    expect((await world()).staff).toBe(12);
    r = await call('PUT', '/api/admin/settings', { slots: 5000 });
    expect((await r.json()).slots).toBe(70);
    r = await call('PUT', '/api/admin/settings', { slots: 0 });
    expect((await r.json()).slots).toBe(0);
  });

  it('speed: applied and clamped', async () => {
    expect((await (await call('PUT', '/api/admin/settings', { speed: 3 })).json()).speed).toBe(3);
    expect((await world()).speed).toBe(3);
    expect((await (await call('PUT', '/api/admin/settings', { speed: 99 })).json()).speed).toBe(8);
    expect((await (await call('PUT', '/api/admin/settings', { speed: 0 })).json()).speed).toBe(0.25);
    expect(sim.speed).toBe(0.25);
  });

  it('pause: the clock stops and starts again', async () => {
    await call('PUT', '/api/admin/settings', { paused: true });
    const a = (await world()).simTime; await sleep(500);
    const b = await world();
    expect(b.paused).toBe(true); expect(b.simTime).toBe(a);
    await call('PUT', '/api/admin/settings', { paused: false });
    await sleep(500);
    expect((await world()).simTime).toBeGreaterThan(a);
  });

  it('several at once', async () => {
    const r = await (await call('PUT', '/api/admin/settings', { slots: 20, speed: 2, paused: true })).json();
    expect(r).toMatchObject({ slots: 20, speed: 2, paused: true });
  });

  it('refuses bad requests with a reason', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{}, /nothing to change/], [[], /JSON object/], ['x', /JSON object|Unexpected token/], [null, /JSON object|Unexpected token/],
      [{ slots: '5' }, /whole number/], [{ slots: 2.5 }, /whole number/], [{ slots: -1 }, /negative/], [{ slots: null }, /whole number/],
      [{ speed: 'fast' }, /speed must be a number/], [{ speed: null }, /speed must be a number/],
      [{ paused: 'yes' }, /true or false/], [{ paused: 1 }, /true or false/],
      [{ tickRate: 60 }, /unknown setting/], [{ __proto__: { x: 1 }, admin: true }, /unknown setting/],
    ];
    for (const [body, text] of cases) {
      const r = await call('PUT', '/api/admin/settings', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(await r.json())).toMatch(text);
    }
    expect((await world()).staff).toBe(40); // nothing changed
    const raw = await fetch(base + '/api/admin/settings', { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{not json' });
    expect(raw.status).toBe(400);
  });
});

describe('viewers see admin changes', () => {
  it('speed and pause appear in snapshots, people joining and leaving are announced, and announcements arrive', async () => {
    const socket = io(base, { transports: ['websocket'], reconnection: false, forceNew: true });
    const got: Message[] = [];
    socket.on('m', (d: ArrayBuffer) => got.push(decode(new Uint8Array(d))));
    await new Promise(r => socket.on('connect', () => r(null)));
    socket.emit('m', encode({ type: 'hello', version: PROTOCOL_VERSION }));
    await sleep(300);
    await call('PUT', '/api/admin/settings', { speed: 3, paused: true, slots: 38 });
    await call('POST', '/api/admin/announce', { text: 'Fire drill at 3pm' });
    await sleep(400);
    socket.close();
    const snaps = got.filter((m): m is Extract<Message, { type: 'snapshot' }> => m.type === 'snapshot');
    const last = snaps[snaps.length - 1];
    expect(last.speed).toBeCloseTo(3, 5); expect(last.paused).toBe(true);
    expect(got.filter(m => m.type === 'leave')).toHaveLength(2);
    expect(got.find(m => m.type === 'event' && m.kind === 'announce')).toMatchObject({ text: 'Fire drill at 3pm' });
  });

  it('announcements must be text of a sensible length', async () => {
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(201) }]) {
      expect((await call('POST', '/api/admin/announce', body)).status).toBe(400);
    }
    expect((await call('POST', '/api/admin/announce', { text: 'hello' })).status).toBe(201);
  });
});

describe('parseSettingsUpdate', () => {
  it('keeps only valid values', () => {
    expect(parseSettingsUpdate({ slots: 3, speed: 100, paused: false })).toEqual({ slots: 3, speed: 8, paused: false });
  });
});

describe('behind a proxy', () => {
  it('lockouts are per real client address, so one bad actor cannot lock out the admin', async () => {
    await app.close();
    process.env.TRUST_PROXY = '1';
    await boot();
    const from = (ip: string, token: string) => fetch(base + '/api/admin/settings', { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip } });
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.9', 'guess' + i)).status).toBe(403);
    expect((await from('203.0.113.9', 'guess')).status).toBe(429);
    expect((await from('198.51.100.7', TOKEN)).status).toBe(200); // the admin, from somewhere else, is unaffected
    delete process.env.TRUST_PROXY;
  });
});
