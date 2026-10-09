import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SaveError, people, serializeWorld, setSeed, sim, hasSlot } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { World } from '../world/world';
import { MIGRATIONS_DIR, runMigrations } from './migrate';
import { WorldStore } from './world-store';
import { PgAccountStore } from '../auth/account-store';
import { AuthProvider } from '../auth/auth.provider';
import { AuthService } from '../auth/auth.service';
import { createHash } from 'node:crypto';

// These need a real PostgreSQL. `npm run test:db` starts a throwaway one in Docker and sets TEST_DATABASE_URL;
// without it they are skipped.
const url = process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!url);

let pool: Pool;
const reset = async () => { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); };

beforeAll(() => { if (url) pool = new Pool({ connectionString: url, max: 6 }); });
afterAll(async () => { await pool?.end(); setSeed(null); });
beforeEach(async () => { if (url) await reset(); });

d('migrations', () => {
  it('create the tables, once, and are recorded', async () => {
    expect(await runMigrations(pool)).toEqual(['001_world_state.sql', '002_accounts.sql']);
    expect(await runMigrations(pool)).toEqual([]);
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map(r => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(['world_state', 'world_state_rejected', 'schema_migrations', 'accounts', 'sessions', 'audit_log']));
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(2);
  });

  it('two servers starting together apply each migration once', async () => {
    const results = await Promise.all([runMigrations(pool), runMigrations(pool), runMigrations(pool)]);
    expect(results.flat()).toEqual(['001_world_state.sql', '002_accounts.sql']);
  });

  it('a failing migration rolls back completely and is not recorded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_world_state.sql'), path.join(dir, '001_world_state.sql'));
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE half_done (x int); SELECT * FROM table_that_does_not_exist;');
    await expect(runMigrations(pool, dir)).rejects.toThrow(/002_bad.sql/);
    const half = await pool.query("SELECT to_regclass('half_done') AS t");
    expect(half.rows[0].t).toBeNull();
    expect((await pool.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map(r => r.name)).toEqual(['001_world_state.sql']);
    fs.rmSync(dir, { recursive: true });
  });
});

d('the world store', () => {
  const options = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 4 };
  beforeEach(async () => { await runMigrations(pool); });

  it('has nothing saved at first', async () => {
    expect(await new WorldStore(pool).load()).toBeNull();
  });

  it('saves and loads the world, and a second save replaces the first', async () => {
    const store = new WorldStore(pool);
    const w = new World(options); w.init();
    for (let i = 0; i < 1500; i++) w.step();
    const first = serializeWorld();
    await store.save(first);
    expect(await store.load()).toEqual(JSON.parse(JSON.stringify(first)));
    for (let i = 0; i < 500; i++) w.step();
    const second = serializeWorld();
    await store.save(second);
    expect(await store.load()).toEqual(JSON.parse(JSON.stringify(second)));
    expect((await pool.query('SELECT count(*)::int AS n FROM world_state')).rows[0].n).toBe(1);
  });

  it('a restored world is the saved one: same people, same positions, same clock', async () => {
    const store = new WorldStore(pool);
    const a = new World(options); a.init();
    for (let i = 0; i < 4000; i++) a.step();
    const want = people.map(p => [p.name, p.state === 'away', p.pos.x, p.pos.z, p.slot!.id]);
    const clock = { t: sim.t, day: sim.day };
    await store.save(serializeWorld());
    const b = new World(options); b.init(await store.load());
    expect(people.map(p => [p.name, p.state === 'away', p.pos.x, p.pos.z, p.slot!.id])).toEqual(want);
    expect({ t: sim.t, day: sim.day }).toEqual(clock);
    expect(people.filter(hasSlot)).toHaveLength(40);
  });

  it('an unreadable save is kept aside, reported, and does not block the next start', async () => {
    const store = new WorldStore(pool);
    await pool.query("INSERT INTO world_state (id, data) VALUES (1, '{\"version\": 1, \"clock\": 5}')");
    await expect(store.load()).rejects.toThrow(SaveError);
    const kept = (await pool.query('SELECT reason, data FROM world_state_rejected')).rows;
    expect(kept).toHaveLength(1);
    expect(kept[0].data).toEqual({ version: 1, clock: 5 });
    expect(await store.load()).toBeNull();
  });
});

d('safety when something is wrong', () => {
  beforeEach(async () => { await runMigrations(pool); });

  it('moving an unreadable save aside is all or nothing', async () => {
    await pool.query("INSERT INTO world_state (id, data) VALUES (1, '{\"version\": 1}')");
    await pool.query('DROP TABLE world_state_rejected'); // so the first half of the move cannot work
    await expect(new WorldStore(pool).load()).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM world_state')).rows[0].n).toBe(1); // still there
  });

  it('a save this office cannot be rebuilt from is left untouched, saving stays off, and the server still starts', async () => {
    process.env.DATABASE_URL = url;
    const w = new World({ tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 2 }); w.init();
    const bad = JSON.parse(JSON.stringify(serializeWorld()));
    bad.people[0].slot = 'desk:999';
    await new WorldStore(pool).save(bad);
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const status = await (await fetch(`http://127.0.0.1:${port}/api/world`)).json() as { staff: number; persistence: { enabled: boolean; reason?: string; restored: boolean } };
    await new Promise(r => setTimeout(r, 800));
    await app.close();
    expect(status.staff).toBe(40);
    expect(status.persistence).toMatchObject({ enabled: false, restored: false });
    expect(status.persistence.reason).toMatch(/desk:999/);
    const row = (await pool.query('SELECT data FROM world_state WHERE id = 1')).rows[0].data;
    expect(row.people[0].slot).toBe('desk:999'); // exactly as it was: nothing replaced it
  }, 30000);
});


d('accounts in PostgreSQL', () => {
  beforeEach(async () => { await runMigrations(pool); });
  const sha = (s: string) => createHash('sha256').update(s).digest();

  it('usernames are unique whatever the capitals, decided by the database itself', async () => {
    const store = new PgAccountStore(pool);
    const a = await store.create({ username: 'Ana', passwordHash: 'h', role: 'player' });
    expect(a).toMatchObject({ username: 'Ana', usernameLower: 'ana', role: 'player', disabled: false, slotSpot: null, spec: null });
    expect(await store.create({ username: 'ANA', passwordHash: 'h', role: 'player' })).toBe('taken');
    const racing = await Promise.all(Array.from({ length: 6 }, () => store.create({ username: 'Race', passwordHash: 'h', role: 'player' })));
    expect(racing.filter(r => r !== 'taken')).toHaveLength(1);
  });

  it('the table itself refuses names that are not 3 to 24 characters or not lower-cased in the key', async () => {
    await expect(pool.query("INSERT INTO accounts (username, username_lower, password_hash) VALUES ('ab', 'ab', 'h')")).rejects.toThrow();
    await expect(pool.query("INSERT INTO accounts (username, username_lower, password_hash) VALUES ('Abc', 'Abc', 'h')")).rejects.toThrow();
    await expect(pool.query("INSERT INTO accounts (username, username_lower, password_hash, role) VALUES ('abc', 'abc', 'h', 'god')")).rejects.toThrow();
  });

  it('finds accounts by name and id, counts admins, changes passwords', async () => {
    const store = new PgAccountStore(pool);
    const p = await store.create({ username: 'Pat', passwordHash: 'h1', role: 'player' }) as { id: number };
    await store.create({ username: 'Boss', passwordHash: 'h', role: 'admin' });
    expect((await store.byLower('pat'))?.id).toBe(p.id);
    expect((await store.byId(p.id))?.username).toBe('Pat');
    expect(await store.byLower('nobody')).toBeNull();
    expect(await store.countAdmins()).toBe(1);
    await store.setPassword(p.id, 'h2', true);
    expect(await store.byId(p.id)).toMatchObject({ passwordHash: 'h2', mustChangePassword: true });
  });

  it('sessions: found by hash, renewed, deleted singly, per account, and when expired; removed with the account', async () => {
    const store = new PgAccountStore(pool);
    const a = await store.create({ username: 'Sess', passwordHash: 'h', role: 'player' }) as { id: number };
    const future = new Date(Date.now() + 3600_000), past = new Date(Date.now() - 1000);
    await store.createSession(a.id, sha('t1'), future, 'ua');
    await store.createSession(a.id, sha('t2'), future, null);
    await store.createSession(a.id, sha('t3'), past, null);
    expect((await store.sessionByHash(sha('t1')))?.account.username).toBe('Sess');
    expect(await store.sessionByHash(sha('nope'))).toBeNull();
    const later = new Date(Date.now() + 7200_000);
    await store.touchSession(sha('t1'), new Date(), later);
    expect((await store.sessionByHash(sha('t1')))?.session.expiresAt.getTime()).toBe(later.getTime());
    expect(await store.deleteExpiredSessions(new Date())).toBe(1);
    await store.deleteAccountSessions(a.id, sha('t1'));
    expect(await store.sessionByHash(sha('t2'))).toBeNull();
    expect(await store.sessionByHash(sha('t1'))).not.toBeNull();
    await store.deleteSession(sha('t1'));
    expect(await store.sessionByHash(sha('t1'))).toBeNull();
    await store.createSession(a.id, sha('t4'), future, null);
    await pool.query('DELETE FROM accounts WHERE id = $1', [a.id]);
    expect((await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0); // cascades
  });

  it('neither the password nor the session token is stored, only hashes', async () => {
    const svc = new AuthService(new PgAccountStore(pool));
    const { token } = await svc.register({ username: 'Hashy', password: 'a-very-long-secret' }, { ip: '1', userAgent: null });
    const dump = JSON.stringify((await pool.query("SELECT a.*, encode(s.token_hash, 'hex') AS th FROM accounts a JOIN sessions s ON s.account_id = a.id")).rows);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain('a-very-long-secret');
    expect(dump).toContain('$argon2id$');
    expect(dump).toContain(sha(token).toString('hex'));
  });

  it('the running server: the first admin is created from the environment, can log in, and the cookie works', async () => {
    process.env.DATABASE_URL = url;
    process.env.ADMIN_USERNAME = 'boss';
    process.env.ADMIN_PASSWORD = 'a-long-admin-pass';
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    expect(app.get(AuthProvider).available).toBe(true);
    const json = (path: string, body: unknown, cookie?: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const login = await json('/api/auth/login', { username: 'Boss', password: 'a-long-admin-pass' });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { account: object }).account).toMatchObject({ username: 'boss', role: 'admin' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const me = await fetch(base + '/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const reg = await json('/api/auth/register', { username: 'newbie', password: 'another-long-pass' });
    expect(reg.status).toBe(201);
    // restart: the admin is not created twice, and the session survives (it is in the database)
    await app.close();
    const again = await NestFactory.create(AppModule, { logger: false });
    configureApp(again);
    await again.listen(0, '127.0.0.1');
    const base2 = `http://127.0.0.1:${(again.getHttpServer().address() as { port: number }).port}`;
    expect((await fetch(base2 + '/api/auth/me', { headers: { cookie } })).status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS n FROM accounts WHERE role = 'admin'")).rows[0].n).toBe(1);
    await again.close();
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  }, 40000);

  it('a weak admin password in the environment creates no admin', async () => {
    process.env.DATABASE_URL = url;
    process.env.ADMIN_USERNAME = 'boss';
    process.env.ADMIN_PASSWORD = 'short';
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    expect((await pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n).toBe(0);
    await app.close();
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  }, 30000);
});

d('the running server', () => {
  beforeEach(async () => { await runMigrations(pool); });
  process.env.SAVE_INTERVAL_MS = '300';

  async function boot() {
    process.env.DATABASE_URL = url;
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    return { app, status: async () => (await fetch(`http://127.0.0.1:${port}/api/world`)).json() as Promise<{ persistence: { enabled: boolean; restored: boolean; saves: number }; staff: number; day: number; simTime: number }> };
  }

  it('saves on shutdown and the next start restores the same office', async () => {
    const one = await boot();
    expect((await one.status()).persistence).toMatchObject({ enabled: true, restored: false });
    await new Promise(r => setTimeout(r, 1200));
    const before = await one.status();
    expect(before.persistence.saves).toBeGreaterThan(0);
    await one.app.close();
    const saved = (await pool.query('SELECT data FROM world_state WHERE id = 1')).rows[0].data;
    expect(saved.people).toHaveLength(40);

    const two = await boot();
    const after = await two.status();
    expect(after.persistence).toMatchObject({ enabled: true, restored: true });
    expect(after.staff).toBe(40);
    expect(after.day).toBe(saved.clock.day);
    expect(after.simTime).toBeGreaterThanOrEqual(saved.clock.t); // the clock continues from where it stopped, never back
    expect(after.simTime - saved.clock.t).toBeLessThan(5);
    expect(people.map(p => p.name).sort()).toEqual(saved.people.map((p: { name: string }) => p.name).sort());
    await two.app.close();
  }, 30000);

  it('RESET_WORLD starts fresh and replaces the save', async () => {
    const one = await boot(); await new Promise(r => setTimeout(r, 700)); await one.app.close();
    process.env.RESET_WORLD = 'true';
    const two = await boot();
    expect((await two.status()).persistence.restored).toBe(false);
    await two.app.close();
    delete process.env.RESET_WORLD;
  }, 30000);

  it('admin changes (staff, speed, pause) survive a restart', async () => {
    process.env.ADMIN_TOKEN = 'tok';
    const one = await boot();
    const base = (one.app.getHttpServer().address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${base}/api/admin/settings`, { method: 'PUT', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ slots: 25, speed: 3, paused: true }) });
    expect(r.status).toBe(200);
    await one.app.close();
    const two = await boot();
    const s = await two.status() as unknown as { staff: number; speed: number; paused: boolean; persistence: { restored: boolean } };
    expect(s).toMatchObject({ staff: 25, speed: 3, paused: true, persistence: { restored: true } });
    await two.app.close();
    delete process.env.ADMIN_TOKEN;
  }, 30000);
});
