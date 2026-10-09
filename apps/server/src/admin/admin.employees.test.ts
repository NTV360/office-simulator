import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSlot, live, people, resetLive, roster, setSeed, sim } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { MemoryAccountStore } from '../auth/account-store';
import { AuthProvider } from '../auth/auth.provider';
import { AuthService } from '../auth/auth.service';
import { MemoryEmployeeStore, type ImportedEmployee } from '../employees/employee-store';
import { EmployeeService } from '../employees/employee.service';
import { SupabaseSource } from '../employees/supabase-source';
import { useAuth } from '../test-support';

// The staff list through the admin API: who the employees are, linking accounts to them, their desks, importing the company's records, and the
// clock mode. The real world and layout; the records are a fake REST interface.

process.env.WORLD_SEED = '1';
delete process.env.DATABASE_URL;

let app: INestApplication, base: string;
let accounts: MemoryAccountStore, employees: MemoryEmployeeStore, service: EmployeeService;
const TOKEN = 'test-token-123';
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const imp = (n: number, over: Partial<ImportedEmployee> = {}): ImportedEmployee => ({ userId: U(n), firstName: `Emp${n}`, lastName: 'Cruz', department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over });

beforeEach(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  accounts = new MemoryAccountStore();
  const auth = new AuthService(accounts, { limits: { logins: 1000 } });
  app.get(AuthProvider).useService(auth);
  useAuth(base, auth);
  employees = new MemoryEmployeeStore();
  service = app.get(EmployeeService);
  service.useStore(employees);
});
afterEach(async () => { await app.close(); setSeed(null); roster.list = null; resetLive(); delete process.env.ADMIN_TOKEN; });

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, json: () => r.json() as Promise<any> };
};
/** The staff list holds these people, and the office is made of them. */
async function staffed(list: ImportedEmployee[]) { await employees.applyImport(list); await service.syncWorld(); }
const makeAccount = async (username: string): Promise<number> => (await (await call('POST', '/api/admin/users', { username, password: 'first-password-1' })).json()).account.id;

describe('the staff list', () => {
  it('is empty at first (the office has made-up staff), and then lists everyone with where they sit and who plays them', async () => {
    expect(await (await call('GET', '/api/admin/employees')).json()).toEqual([]);
    await staffed([imp(1), imp(2, { department: 'Human Resources' }), imp(3, { desk: 'C3' })]);
    expect(people.filter(hasSlot)).toHaveLength(3); // the made-up staff made way
    const list = await (await call('GET', '/api/admin/employees')).json();
    expect(list.map((e: { name: string }) => e.name)).toEqual(['Emp1 Cruz', 'Emp2 Cruz', 'Emp3 Cruz']);
    expect(list[2]).toMatchObject({ desk: 'C3', seat: 'C3', inOffice: true, hasLook: false, account: null, department: 'UI/UX' });
    expect(list[1].seat).toMatch(/^HR/);
  });
  it('says nothing about contact details or anything but what the admin needs', async () => {
    await staffed([imp(1)]);
    const [e] = await (await call('GET', '/api/admin/employees')).json();
    expect(Object.keys(e).sort()).toEqual(['account', 'department', 'desk', 'hasLook', 'inOffice', 'intern', 'name', 'present', 'seat', 'shift', 'userId']);
  });
});

describe('linking an account to an employee', () => {
  it('links and unlinks; the employee list and the account list say so', async () => {
    await staffed([imp(1), imp(2)]);
    const id = await makeAccount('ana');
    const r = await call('POST', `/api/admin/users/${id}/employee`, { employeeId: U(2) });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, employeeId: U(2), person: 'Emp2 Cruz' });
    expect((await (await call('GET', '/api/admin/employees')).json()).find((e: { userId: string }) => e.userId === U(2)).account).toEqual({ id, username: 'ana' });
    expect((await (await call('GET', '/api/admin/users')).json())[0]).toMatchObject({ username: 'ana', employeeId: U(2) });
    expect(people.find(p => p.userId === U(2))!.owner).toBe(id);
    const u = await call('POST', `/api/admin/users/${id}/employee`, { employeeId: null });
    expect(await u.json()).toMatchObject({ ok: true, employeeId: null, person: 'Emp2 Cruz' });
    expect((await (await call('GET', '/api/admin/users')).json())[0].employeeId).toBeNull();
  });
  it('is refused with a plain message: a bad id, an unknown account, one who is already linked, an employee someone plays, one not in the office', async () => {
    await staffed([imp(1), imp(2)]);
    const a = await makeAccount('ana'), b = await makeAccount('ben');
    expect((await call('POST', `/api/admin/users/${a}/employee`, { employeeId: 'nope' })).status).toBe(400);
    expect((await call('POST', `/api/admin/users/${a}/employee`, {})).status).toBe(400);
    expect((await call('POST', `/api/admin/users/9999/employee`, { employeeId: U(1) })).status).toBe(404);
    expect((await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(9) })).status).toBe(409); // nobody by that id in the office
    expect((await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(1) })).status).toBe(201);
    expect((await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(2) })).status).toBe(409); // ana plays one already
    expect((await call('POST', `/api/admin/users/${b}/employee`, { employeeId: U(1) })).status).toBe(409); // somebody plays them
    expect((await call('POST', `/api/admin/users/${b}/employee`, { employeeId: null })).status).toBe(400); // nothing to unlink
  });
  it('a look the account already made becomes the employee\'s; an employee\'s look becomes the account\'s', async () => {
    await staffed([imp(1, { character: { type: 'blocky', hair: { style: 'bun', color: '#112233' } } }), imp(2)]);
    const a = await makeAccount('ana'), b = await makeAccount('ben');
    const mine = { type: 'chibi', body: 'female', hair: { style: 'afro', color: '#000000' } };
    await accounts.setSpec(b, mine);
    await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(1) }); // the employee has a look, the account none
    expect((await accounts.byId(a))!.spec).toMatchObject({ type: 'blocky', hair: { style: 'bun' } });
    await call('POST', `/api/admin/users/${b}/employee`, { employeeId: U(2) }); // the account has a look, the employee none
    expect((await employees.byId(U(2)))!.character).toMatchObject({ type: 'chibi', body: 'female' });
    expect(people.find(p => p.userId === U(2))!.spec).toMatchObject({ type: 'chibi', body: 'female', hair: { style: 'afro' } });
  });
  it('an account cannot be given a desk once it plays an employee', async () => {
    await staffed([imp(1)]);
    const a = await makeAccount('ana');
    await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(1) });
    expect((await call('POST', `/api/admin/users/${a}/assign-slot`, { spot: 'desk:3' })).status).toBe(409);
  });
});

describe('choosing a desk for an employee', () => {
  it('moves them there (the HR office only for HR), and refuses a desk that does not exist, is chosen already or is for another department', async () => {
    await staffed([imp(1), imp(2), imp(3, { department: 'Human Resources' })]);
    expect((await call('PUT', `/api/admin/employees/${U(1)}`, {})).status).toBe(400);
    expect((await call('PUT', `/api/admin/employees/${U(1)}`, { desk: 'Z9' })).status).toBe(400);
    expect((await call('PUT', `/api/admin/employees/${U(1)}`, { desk: 7 })).status).toBe(400);
    expect((await call('PUT', `/api/admin/employees/nope`, { desk: 'A1' })).status).toBe(400);
    expect((await call('PUT', `/api/admin/employees/${U(9)}`, { desk: 'A1' })).status).toBe(404);
    expect((await call('PUT', `/api/admin/employees/${U(1)}`, { desk: 'HR2' })).status).toBe(409); // not HR
    const ok = await call('PUT', `/api/admin/employees/${U(1)}`, { desk: 'D7' });
    expect(await ok.json()).toEqual({ ok: true, desk: 'D7' });
    expect(people.find(p => p.userId === U(1))!.slot!.deskId).toBe('D7');
    expect((await call('PUT', `/api/admin/employees/${U(2)}`, { desk: 'D7' })).status).toBe(409); // chosen
    expect((await call('PUT', `/api/admin/employees/${U(3)}`, { desk: 'HR2' })).status).toBe(200);
    expect(people.find(p => p.userId === U(3))!.slot!.deskId).toBe('HR2');
    expect((await call('PUT', `/api/admin/employees/${U(1)}`, { desk: null })).status).toBe(200); // none: stays where they are
  });
});

describe('importing the company\'s records', () => {
  const records = (rows: unknown[]) => ({
    employees: rows, employment_types: [], shifts: [], character_information: [],
  } as Record<string, unknown>);
  const fakeSource = (tables: Record<string, unknown>, status = 200) => new SupabaseSource({
    url: 'https://records.example.test', secretKey: 'the-secret-key',
    fetch: (async (input: unknown) => {
      const table = new URL(String(input)).pathname.split('/').pop()!;
      if (status !== 200) return new Response('{}', { status });
      return new Response(JSON.stringify(tables[table] ?? []), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const row = (n: number, extra: Record<string, unknown> = {}) => ({ user_id: U(n), first_name: `Emp${n}`, last_name: 'Cruz', employment_type_id: null, shift_id: null, department: { name: 'UI/UX' }, ...extra });

  it('says there is no source when none is configured, and refuses to import', async () => {
    const s = await (await call('GET', '/api/admin/import')).json();
    expect(s).toMatchObject({ configured: false, lastImportAt: null, clockMode: 'sim' });
    const r = await call('POST', '/api/admin/import');
    expect(r.status).toBe(409);
    expect((await r.json()).message).toMatch(/SUPABASE_URL/);
  });
  it('imports, makes the office of it, and reports what it did; a second import changes nothing', async () => {
    service.useSource(fakeSource(records([row(1), row(2), row(3)])));
    const r = await call('POST', '/api/admin/import');
    expect(r.status).toBe(201);
    const out = (await r.json()).result;
    expect(out).toMatchObject({ added: 3, updated: 0, removed: 0, sync: { added: 3, replaced: 40 } });
    expect(people.filter(hasSlot).map(p => p.userId).sort()).toEqual([U(1), U(2), U(3)]);
    const again = (await (await call('POST', '/api/admin/import')).json()).result;
    expect(again).toMatchObject({ added: 0, updated: 0, removed: 0, sync: { added: 0, updated: 0, removed: 0 } });
    expect(await (await call('GET', '/api/admin/import')).json()).toMatchObject({ configured: true, lastImportOk: true, lastImportError: null });
  });
  it('a failed import (the records are unreachable or empty) changes nothing, says why, and never shows the key', async () => {
    await staffed([imp(1), imp(2)]);
    service.useSource(fakeSource(records([row(1), row(2)]), 500));
    const failed = await call('POST', '/api/admin/import');
    expect(failed.status).toBe(409);
    expect(JSON.stringify(await failed.json())).not.toContain('the-secret-key');
    expect(people.filter(hasSlot)).toHaveLength(2);
    expect(await (await call('GET', '/api/admin/import')).json()).toMatchObject({ lastImportOk: false });
    service.useSource(fakeSource(records([])));
    const empty = await call('POST', '/api/admin/import');
    expect(empty.status).toBe(409);
    expect((await empty.json()).message).toMatch(/empty/);
    expect(people.filter(hasSlot)).toHaveLength(2); // (an empty answer is not "everyone left")
  });
  it('an employee who leaves the records leaves the office; a new one comes in; a changed name shows', async () => {
    service.useSource(fakeSource(records([row(1), row(2)])));
    await call('POST', '/api/admin/import');
    service.useSource(fakeSource(records([row(2, { first_name: 'Renamed' }), row(3)])));
    const out = (await (await call('POST', '/api/admin/import')).json()).result;
    expect(out).toMatchObject({ added: 1, updated: 1, removed: 1 });
    expect(people.filter(hasSlot).map(p => p.name).sort()).toEqual(['Emp3 Cruz', 'Renamed Cruz']);
  });
  it('the audit log records who imported, linked and chose desks (and never a key)', async () => {
    service.useSource(fakeSource(records([row(1)])));
    await call('POST', '/api/admin/import');
    const a = await makeAccount('ana');
    await call('POST', `/api/admin/users/${a}/employee`, { employeeId: U(1) });
    await call('PUT', `/api/admin/employees/${U(1)}`, { desk: 'B2' });
    const log = await (await call('GET', '/api/admin/audit')).json();
    expect(log.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['employees.import', 'employee.link', 'employee.desk']));
    expect(JSON.stringify(log)).not.toContain('the-secret-key');
  });
});

describe('the clock mode', () => {
  it('Live follows the real time and Simulate starts the day or the night; it is one setting for the whole office, and it is reported', async () => {
    expect((await (await call('GET', '/api/admin/settings')).json())).toMatchObject({ clockMode: 'sim', attendance: false });
    const live1 = await (await call('PUT', '/api/admin/settings', { clockMode: 'live' })).json();
    expect(live1.clockMode).toBe('live');
    expect(live.mode).toBe('live');
    await new Promise(r => setTimeout(r, 300)); // a few ticks: the clock follows the real one
    const t = sim.t, real = new Date(), manila = (new Date(real.getTime() + (real.getTimezoneOffset() + 480) * 60000));
    const now = manila.getHours() * 60 + manila.getMinutes();
    const wanted = now < 360 ? now + 1440 : now;
    expect(Math.abs(t - wanted)).toBeLessThan(3);
    expect((await (await call('PUT', '/api/admin/settings', { clockMode: 'sim', simStart: 'night' })).json()).clockMode).toBe('sim');
    expect(sim.t).toBeGreaterThanOrEqual(21 * 60 + 30);
    expect((await (await call('PUT', '/api/admin/settings', { clockMode: 'sim' })).json()).clockMode).toBe('sim');
    expect(sim.t).toBeLessThan(11 * 60);
  });
  it('is checked: only "sim" or "live", and a start only with Simulate', async () => {
    for (const bad of [{ clockMode: 'fast' }, { clockMode: 1 }, { clockMode: 'live', simStart: 'day' }, { simStart: 'night' }, { clockMode: 'sim', simStart: 'noon' }]) {
      expect((await call('PUT', '/api/admin/settings', bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
  it('switching to Live reads who is clocked in first, so the people in the office are the people at work', async () => {
    const clockedIn = new Date(Date.now() - 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    service.useSource(new SupabaseSource({
      url: 'https://records.example.test', secretKey: 'k',
      fetch: (async (input: unknown) => {
        const table = new URL(String(input)).pathname.split('/').pop()!;
        const data: Record<string, unknown[]> = { employees: [{ user_id: U(1), first_name: 'In', last_name: 'Now', employment_type_id: null, shift_id: null, department: null }, { user_id: U(2), first_name: 'Not', last_name: 'Today', employment_type_id: null, shift_id: null, department: null }], attendances: [{ employee_id: U(1), clock_in: clockedIn, clock_out: null }] };
        return new Response(JSON.stringify(data[table] ?? []), { status: 200 });
      }) as unknown as typeof fetch,
    }));
    await call('POST', '/api/admin/import');
    await call('PUT', '/api/admin/settings', { clockMode: 'live' });
    expect((await (await call('GET', '/api/admin/settings')).json()).attendance).toBe(true);
    const inNow = people.find(p => p.userId === U(1))!, notToday = people.find(p => p.userId === U(2))!;
    expect(notToday.absent).toBe(true);
    expect(notToday.state).toBe('away');
    expect(inNow.absent).toBe(false);
  });
});
