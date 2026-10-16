import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { officeDate, resetLive, roster, setSeed } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';
import { MemoryAccountStore } from '../auth/account-store';
import { AuthProvider } from '../auth/auth.provider';
import { AuthService } from '../auth/auth.service';
import { api, sessionFor, useAuth } from '../test-support';
import { MemoryEmployeeStore, type ImportedEmployee } from './employee-store';
import { EmployeeService } from './employee.service';
import { SupabaseSource } from './supabase-source';

// GET /api/attendance/summary: the page's "Absent" tab. Names of the staff who have no clock-in today in office time, for a signed-in account only,
// and nothing else about them. The records are a fake REST interface.

process.env.WORLD_SEED = '1';
delete process.env.DATABASE_URL;

let app: INestApplication, base: string, service: EmployeeService, store: MemoryEmployeeStore;
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const imp = (n: number, over: Partial<ImportedEmployee> = {}): ImportedEmployee => ({ userId: U(n), firstName: `Emp${n}`, lastName: 'Cruz', department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over });
const dbTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const HOUR = 3600e3;

beforeEach(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const auth = new AuthService(new MemoryAccountStore(), { limits: { logins: 1000 } });
  app.get(AuthProvider).useService(auth);
  useAuth(base, auth);
  store = new MemoryEmployeeStore();
  service = app.get(EmployeeService);
  service.useStore(store);
});
afterEach(async () => { await app.close(); setSeed(null); roster.list = null; resetLive(); });

/** A records source whose attendances table is `clockIns` (employee number and when), counting how many times it was read. */
function source(clockIns: Array<[number, Date]>, status = 200) {
  const reads = { attendances: 0 };
  const s = new SupabaseSource({
    url: 'https://records.example.test', secretKey: 'the-secret-key',
    fetch: (async (input: unknown) => {
      const table = new URL(String(input)).pathname.split('/').pop()!;
      if (status !== 200) return new Response('{}', { status });
      if (table === 'attendances') { reads.attendances++; return new Response(JSON.stringify(clockIns.map(([n, at]) => ({ employee_id: U(n), clock_in: dbTime(at) }))), { status: 200 }); }
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { s, reads };
}
const summary = async (cookie?: string, headers: Record<string, string> = {}) => api(base, 'GET', '/api/attendance/summary', undefined, { ...(cookie ? { cookie } : {}), ...headers });

describe('the absent-today list', () => {
  it('is for signed-in accounts only', async () => {
    expect((await summary()).status).toBe(401);
  });

  it('is unavailable (503) with no source of records', async () => {
    await store.applyImport([imp(1)]);
    expect((await summary(await sessionFor(base, 'ana'))).status).toBe(503);
  });

  it('names the staff with no clock-in today, in order, and sends nothing else about them', async () => {
    await store.applyImport([imp(1), imp(2, { firstName: 'Ben' }), imp(3, { firstName: 'Cat' }), imp(4, { firstName: 'Dan' })]);
    const now = new Date();
    const { s } = source([[1, new Date(now.getTime() - 60_000)], [3, new Date(now.getTime() - 60_000)]]);
    service.useSource(s);
    const r = await summary(await sessionFor(base, 'ana'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ today: officeDate(now), absent: ['Ben Cruz', 'Dan Cruz'] });
    expect(JSON.stringify(r.body)).not.toContain(U(2)); // (no ids)
  });

  it('does not count yesterday\'s clock-in, and leaves out someone who is no longer in the records', async () => {
    await store.applyImport([imp(1), imp(2, { firstName: 'Ben' }), imp(3, { firstName: 'Cat' })]);
    await store.applyImport([imp(1), imp(2, { firstName: 'Ben' })]); // Cat has left the records
    const now = new Date();
    const { s } = source([[1, new Date(now.getTime() - 25 * HOUR)]]); // more than a day ago: not today in office time
    service.useSource(s);
    const r = await summary(await sessionFor(base, 'ana'));
    expect(r.body.absent).toEqual(['Ben Cruz', 'Emp1 Cruz']);
  });

  it('is read once a minute however many ask, and keeps the last list when a later read fails', async () => {
    await store.applyImport([imp(1), imp(2, { firstName: 'Ben' })]);
    const { s, reads } = source([]);
    service.useSource(s);
    const cookie = await sessionFor(base, 'ana');
    const [a, b] = await Promise.all([summary(cookie), summary(cookie)]);
    expect(a.body.absent).toHaveLength(2); expect(b.body.absent).toHaveLength(2);
    await summary(cookie);
    expect(reads.attendances).toBe(1);
    // after the minute the records are read again; a failing read gives the last known list
    service.useSource(source([], 500).s);
    const later = new Date(Date.now() + 61_000);
    expect(await service.attendanceSummary(later)).toEqual({ today: officeDate(new Date()), absent: ['Ben Cruz', 'Emp1 Cruz'] });
  });

  it('refuses a request that came from another site', async () => {
    await store.applyImport([imp(1)]);
    service.useSource(source([]).s);
    const cookie = await sessionFor(base, 'ana');
    expect((await summary(cookie, { origin: 'https://evil.example.test' })).status).toBe(403);
  });
});
