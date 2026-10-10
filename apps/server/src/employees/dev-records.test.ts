import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deskSeat, simRole } from '@office/shared';
import { SupabaseSource } from './supabase-source';

// The made-up company that `npm run dev:records` serves (scripts/dev-records.json): it must be a company the real importer accepts, whose
// every employee fits in the office, so that a coworker's test data is never silently broken.

const file = path.resolve(__dirname, '../../../../scripts/dev-records.json');
const tables = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown[]>;
const fakeFetch = (async (input: unknown) => {
  const table = new URL(String(input)).pathname.split('/').pop()!;
  return new Response(JSON.stringify(tables[table] ?? []), { status: 200 });
}) as unknown as typeof fetch;
const source = () => new SupabaseSource({ url: 'http://127.0.0.1:18090', secretKey: 'dev-records-key', fetch: fakeFetch });

describe('the made-up company for local testing', () => {
  it('imports cleanly: every record is taken, none skipped, ids and names are distinct', async () => {
    const warn: string[] = [];
    const list = await new SupabaseSource({ url: 'http://127.0.0.1:18090', secretKey: 'dev-records-key', fetch: fakeFetch, log: { warn: m => warn.push(m) } }).employees();
    expect(list).toHaveLength(tables.employees.length);
    expect(warn).toEqual([]);
    expect(new Set(list.map(e => e.userId)).size).toBe(list.length);
    expect(new Set(list.map(e => `${e.firstName} ${e.lastName}`)).size).toBe(list.length);
  });

  it('fits in the office: fewer people than desks, the HR people fit in the HR office, and the chosen desks are real and allowed', async () => {
    const list = await source().employees();
    expect(list.length).toBeLessThan(80);
    expect(list.filter(e => e.department === 'Human Resources').length).toBeLessThanOrEqual(6);
    const chosen = list.filter(e => e.desk);
    expect(chosen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(chosen.map(e => e.desk)).size).toBe(chosen.length);
    for (const e of chosen) { const s = deskSeat(e.desk); expect(s, e.desk!).not.toBeNull(); if (s!.island.department) expect(s!.island.department).toBe(e.department); }
  });

  it('has what the tests and the accounts built on it need: the four players, Hazel, interns, three shifts, every department a role', async () => {
    const list = await source().employees();
    const names = list.map(e => `${e.firstName} ${e.lastName}`);
    for (const n of ['Ana Lopez', 'Ben Reyes', 'Cat Dizon', 'Dan Cruz', 'Hazel Sellote']) expect(names, n).toContain(n);
    expect(list.some(e => e.intern)).toBe(true);
    expect(new Set(list.map(e => e.shift?.code))).toEqual(new Set(['DAY', 'NIGHT', 'MID']));
    for (const e of list) expect(simRole(e.department), e.department ?? '').toBeTruthy();
  });
});
