import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { movedObjects, objects, people, pickUp, resetAllObjects, setObjectPose, setSeed } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { MemoryAccountStore } from '../auth/account-store';
import { AuthProvider } from '../auth/auth.provider';
import { AuthService } from '../auth/auth.service';
import { useAuth } from '../test-support';

// The things in the office that players move, through the admin API: what is out of place, putting one or all back, the audit log.

process.env.WORLD_SEED = '1';
process.env.PHYSICS = 'off'; // (these put chairs anywhere to test the admin's requests alone: physics would push them about. physics/item-physics.test.ts covers that)
delete process.env.DATABASE_URL;

let app: INestApplication, base: string;
const TOKEN = 'test-token-123';
beforeEach(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const accounts = new MemoryAccountStore();
  const auth = new AuthService(accounts, { limits: { logins: 1000 } });
  app.get(AuthProvider).useService(auth);
  useAuth(base, auth);
  resetAllObjects();
});
afterEach(async () => { resetAllObjects(); await app.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, json: () => r.json() as Promise<any> };
};
const chairs = () => objects.all().filter(o => o.type === 'chair-wood');

describe('the objects an admin can see and put back', () => {
  it('lists what is out of place (nothing at first), with where it is, where it started and who holds it', async () => {
    expect(await (await call('GET', '/api/admin/objects')).json()).toEqual([]);
    const [a, b] = chairs();
    setObjectPose(a, a.x + 1, a.z + 2, 1);
    pickUp(b, people[0].id);
    const list = await (await call('GET', '/api/admin/objects')).json();
    expect(list.map((o: { id: string }) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.find((o: { id: string }) => o.id === a.id)).toMatchObject({ type: 'chair-wood', carriedBy: null, homeX: Math.round(a.home.x * 100) / 100 });
    expect(list.find((o: { id: string }) => o.id === b.id).carriedBy).toBe(people[0].name);
  });

  it('puts one back (a carried one too), says what it did, and writes it in the audit log', async () => {
    const [a, b] = chairs();
    setObjectPose(a, a.x + 1, a.z, 0);
    pickUp(b, people[0].id);
    const r = await call('POST', '/api/admin/objects/reset', { object: a.id });
    expect([r.status, (await r.json()).reset]).toEqual([201, 1]);
    expect(movedObjects().map(o => o.id)).toEqual([b.id]);
    const r2 = await call('POST', '/api/admin/objects/reset', { object: b.id });
    expect((await r2.json()).reset).toBe(1);
    expect(b.carriedBy).toBeNull();
    expect((await (await call('POST', '/api/admin/objects/reset', { object: a.id })).json()).reset).toBe(0); // already home
    const log = await (await call('GET', '/api/admin/audit')).json();
    expect(log.filter((l: { action: string }) => l.action === 'objects.reset').map((l: { target: string }) => l.target)).toEqual([a.id, b.id, a.id].reverse());
  });

  it('puts everything back at once, counting what was out', async () => {
    for (const c of chairs().slice(0, 4)) setObjectPose(c, c.x + .5, c.z, 0);
    const r = await call('POST', '/api/admin/objects/reset', { all: true });
    expect((await r.json()).reset).toBe(4);
    expect(movedObjects()).toEqual([]);
    const log = await (await call('GET', '/api/admin/audit')).json();
    expect(log[0]).toMatchObject({ action: 'objects.reset', target: 'everything' });
  });

  it('leaves a chair somebody sits in where it is (it would jump from under them), and says how many it skipped', async () => {
    const [a, b] = chairs();
    setObjectPose(a, a.x + 1, a.z, 0); setObjectPose(b, b.x + 1, b.z, 0);
    a.link!.spot.occupant = people[0];
    expect((await call('POST', '/api/admin/objects/reset', { object: a.id })).status).toBe(409);
    const r = await (await call('POST', '/api/admin/objects/reset', { all: true })).json();
    expect([r.reset, r.skipped]).toEqual([1, 1]);
    expect(movedObjects().map(o => o.id)).toEqual([a.id]);
    a.link!.spot.occupant = null;
    expect((await (await call('POST', '/api/admin/objects/reset', { object: a.id })).json()).reset).toBe(1);
  });

  it('refuses nonsense, an unknown object, and anyone without the admin password', async () => {
    for (const body of [{}, { object: 5 }, { object: 'obj:x' }, { object: 'obj:1; drop' }, { all: 'yes' }]) expect((await call('POST', '/api/admin/objects/reset', body)).status, JSON.stringify(body)).toBe(400);
    expect((await call('POST', '/api/admin/objects/reset', { object: 'obj:99999' })).status).toBe(404);
    expect((await call('POST', '/api/admin/objects/reset', { all: true }, 'wrong')).status).toBe(403);
    expect((await call('GET', '/api/admin/objects', undefined, null)).status).toBe(403);
  });
});
