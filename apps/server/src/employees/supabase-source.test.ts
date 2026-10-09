import { describe, expect, it } from 'vitest';
import { SourceError, SupabaseSource } from './supabase-source';

// The employee records are read through their REST interface. A fake one stands in for them: every table is a list of rows, and the fake
// answers the way the real one does (a page at a time, with the headers the server must send).

const KEY = 'secret-service-role-key-do-not-leak';
const URL_ = 'https://records.example.test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Fake { calls: Array<{ url: URL; headers: Record<string, string> }>; fetch: typeof fetch }
/** Tables by name; a number instead of rows is the status the table answers with. */
function fake(tables: Record<string, unknown>, opts: { network?: boolean } = {}): Fake {
  const calls: Fake['calls'] = [];
  const f = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, headers });
    if (opts.network) throw new TypeError('fetch failed');
    const table = url.pathname.split('/').pop()!;
    const data = tables[table];
    if (typeof data === 'number') return new Response(JSON.stringify({ message: 'nope ' + KEY }), { status: data });
    if (data === undefined) return new Response('{}', { status: 404 });
    if (typeof data === 'string') return new Response(data, { status: 200 });
    const [from, to] = (headers.range ?? '0-999').split('-').map(Number);
    return new Response(JSON.stringify((data as unknown[]).slice(from, to + 1)), { status: (data as unknown[]).length > to + 1 ? 206 : 200 });
  }) as unknown as typeof fetch;
  return { calls, fetch: f };
}
const source = (f: Fake, warn: string[] = []) => new SupabaseSource({ url: URL_, secretKey: KEY, fetch: f.fetch, log: { warn: m => warn.push(m) } });

const EMPLOYEES = [
  { user_id: id(1), first_name: 'Ana', last_name: 'Cruz', employment_type_id: 1, shift_id: 10, department: { name: 'UI/UX' } },
  { user_id: id(2).toUpperCase(), first_name: '  Ben  ', last_name: null, employment_type_id: 2, shift_id: 11, department: null },
  { user_id: id(3), first_name: 'Cat', last_name: 'Reyes', employment_type_id: null, shift_id: null, department: { name: 'Human Resources' } },
];
const TABLES = {
  employees: EMPLOYEES,
  employment_types: [{ employment_type_id: 1, code: 'REG', description: 'Regular' }, { employment_type_id: 2, code: 'OJT', description: 'On the job training' }],
  shifts: [{ shift_id: 10, code: 'DAY', start_time: '09:00:00', end_time: '18:00:00' }, { shift_id: 11, code: 'NIGHT', start_time: '21:00:00', end_time: '06:00:00' }],
  character_information: [{ user_id: id(1), character_data: { type: 'blocky', hair: { style: 'bun', color: '#222222' }, desk: 'A3' } }, { user_id: id(3), character_data: { type: 'chibi', desk: 'Z9' } }],
};

describe('the constructor', () => {
  it('takes only a web address and a key without spaces, and never shows the key', () => {
    for (const url of ['', 'not a url', 'ftp://x.example', 'file:///etc/passwd', 'javascript:alert(1)']) expect(() => new SupabaseSource({ url, secretKey: KEY }), url).toThrow(SourceError);
    for (const secretKey of ['', 'two words', 'line\nbreak']) expect(() => new SupabaseSource({ url: URL_, secretKey }), JSON.stringify(secretKey)).toThrow(SourceError);
    try { new SupabaseSource({ url: 'ftp://x', secretKey: KEY }); } catch (e) { expect(String(e)).not.toContain(KEY); }
  });
  it('a trailing slash or a path on the address is fine', async () => {
    const f = fake(TABLES);
    await new SupabaseSource({ url: URL_ + '/', secretKey: KEY, fetch: f.fetch }).employees();
    expect(f.calls[0].url.pathname).toBe('/rest/v1/employees');
    const g = fake(TABLES);
    await new SupabaseSource({ url: URL_ + '/proxy/', secretKey: KEY, fetch: g.fetch }).employees();
    expect(g.calls[0].url.pathname).toBe('/proxy/rest/v1/employees');
  });
});

describe('employees', () => {
  it('become imported employees: names, department, intern, shift minutes, look and desk', async () => {
    const list = await source(fake(TABLES)).employees();
    expect(list.map(e => [e.userId, e.firstName, e.lastName, e.department, e.intern])).toEqual([
      [id(1), 'Ana', 'Cruz', 'UI/UX', false],
      [id(2), 'Ben', '', null, true], // (an id in capitals is lower-cased; an OJT type marks an intern; a missing last name is empty)
      [id(3), 'Cat', 'Reyes', 'Human Resources', false],
    ]);
    expect(list[0].shift).toEqual({ code: 'DAY', start: 540, end: 1080 });
    expect(list[1].shift).toEqual({ code: 'NIGHT', start: 1260, end: 360 });
    expect(list[2].shift).toBeNull();
  });
  it('a saved look is made valid, and a desk that does not exist is dropped', async () => {
    const list = await source(fake(TABLES)).employees();
    expect(list[0].character).toMatchObject({ type: 'blocky', hair: { style: 'bun', color: '#222222' }, angry: false });
    expect(list[0].desk).toBe('A3');
    expect(list[2].desk).toBeNull(); // Z9 is not a desk
    expect(list[1].character).toBeNull();
  });
  it('asks for only the fields it uses (no contact details, birth dates, RFID values or access roles), with the secret key as the REST interface wants it', async () => {
    const f = fake(TABLES);
    await source(f).employees();
    for (const c of f.calls) {
      expect(c.headers.apikey).toBe(KEY);
      expect(c.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(c.url.searchParams.get('select')).toBeTruthy();
      expect(c.url.searchParams.get('select')).not.toContain('*');
    }
    const first = f.calls.find(c => c.url.pathname.endsWith('/employees'))!;
    expect(first.url.searchParams.get('select')).toBe('user_id,first_name,last_name,employment_type_id,shift_id,department:departments(name)');
    expect(first.url.searchParams.get('deleted_at')).toBe('is.null');
    expect(f.calls.some(c => /birth|contact|rfid|email|phone|emergency|role/i.test(c.url.search))).toBe(false);
  });
  it('malformed rows are skipped, and a repeat of an id is taken once', async () => {
    const warn: string[] = [];
    const list = await source(fake({
      ...TABLES,
      employees: [...EMPLOYEES, { user_id: 'not-a-uuid', first_name: 'Bad' }, { user_id: id(4), first_name: '   ' }, { user_id: id(1), first_name: 'Ana again' }, null, 'x', [1], { first_name: 'No id' }],
    }), warn).employees();
    expect(list.map(e => e.userId)).toEqual([id(1), id(2), id(3)]);
    expect(warn.join(' ')).toMatch(/4 employee records skipped/);
  });
  it('text is trimmed and capped; a weird department is dropped', async () => {
    const [e] = await source(fake({ ...TABLES, employees: [{ user_id: id(1), first_name: 'x'.repeat(500), last_name: 'y'.repeat(500), department: { name: 'z'.repeat(500) } }, { user_id: id(2), first_name: 'A', department: 'a string' }] })).employees();
    expect(e.firstName).toHaveLength(100); expect(e.lastName).toHaveLength(100); expect(e.department).toHaveLength(80);
    const list = await source(fake({ ...TABLES, employees: [{ user_id: id(2), first_name: 'A', department: 'a string' }] })).employees();
    expect(list[0].department).toBeNull();
  });
  it('a hostile look cannot reach the office: it comes back valid', async () => {
    const [e] = await source(fake({ ...TABLES, character_information: [{ user_id: id(1), character_data: JSON.parse('{"__proto__":{"x":1},"accessories":["constructor"],"hair":"<script>"}') }] })).employees();
    expect(e.character).toMatchObject({ accessories: [], hair: expect.objectContaining({ style: expect.any(String) }) });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('reads every page (the interface gives 1000 rows at a time)', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ user_id: id(i + 1), first_name: `P${i}`, last_name: 'L' }));
    const f = fake({ ...TABLES, employees: many });
    const list = await source(f).employees();
    expect(list).toHaveLength(2500);
    expect(f.calls.filter(c => c.url.pathname.endsWith('/employees')).map(c => c.headers.range)).toEqual(['0-999', '1000-1999', '2000-2999']);
  });
  it('tables it can do without (employment types, shifts, looks) being unreadable only costs those details', async () => {
    const warn: string[] = [];
    const list = await source(fake({ ...TABLES, employment_types: 403, shifts: 500, character_information: 401 }), warn).employees();
    expect(list).toHaveLength(3);
    expect(list.every(e => !e.intern && e.shift === null && e.character === null && e.desk === null)).toBe(true);
    expect(warn).toHaveLength(3);
    expect(warn.join(' ')).not.toContain(KEY);
  });
});

describe('when the records cannot be read', () => {
  it('an error answer is a SourceError that says the status and never the key', async () => {
    for (const status of [401, 403, 500, 503]) {
      const err = await source(fake({ ...TABLES, employees: status })).employees().catch(e => e);
      expect(err).toBeInstanceOf(SourceError);
      expect(err.message).toContain(String(status));
      expect(err.message).not.toContain(KEY);
    }
  });
  it('no network, a non-JSON answer and a non-list answer are SourceErrors too', async () => {
    expect(await source(fake(TABLES, { network: true })).employees().catch(e => e)).toBeInstanceOf(SourceError);
    expect(await source(fake({ ...TABLES, employees: 'not json {' })).employees().catch(e => e)).toBeInstanceOf(SourceError);
    expect(await source(fake({ ...TABLES, employees: '{"message":"object"}' })).employees().catch(e => e)).toBeInstanceOf(SourceError);
  });
  it('a request that never answers is given up on', async () => {
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))); })) as unknown as typeof fetch;
    const err = await new SupabaseSource({ url: URL_, secretKey: KEY, fetch: hang, timeoutMs: 50 }).employees().catch(e => e);
    expect(err).toBeInstanceOf(SourceError);
  });
});

describe('attendance', () => {
  const now = new Date('2026-10-10T08:00:00Z');
  const rows = [
    { employee_id: id(1), clock_in: '2026-10-10 00:55:10.123', clock_out: null },
    { employee_id: id(1), clock_in: '2026-10-09 00:50:00', clock_out: '2026-10-09 10:00:00' }, // yesterday's: the newest one counts (they come newest first)
    { employee_id: id(2), clock_in: '2026-10-09 23:00:00', clock_out: '2026-10-10 03:30:00' },
    { employee_id: 'bad', clock_in: '2026-10-10 00:00:00', clock_out: null },
    { employee_id: id(3), clock_in: 'garbage', clock_out: 7 },
  ];
  it('is each employee\'s latest record: in (no clock-out), gone home (a clock-out), as ISO times', async () => {
    const list = await source(fake({ attendances: rows })).attendance(now);
    expect(list).toEqual([
      { userId: id(1), clockIn: '2026-10-10T00:55:10.123Z', clockOut: null },
      { userId: id(2), clockIn: '2026-10-09T23:00:00.000Z', clockOut: '2026-10-10T03:30:00.000Z' },
      { userId: id(3), clockIn: null, clockOut: null },
    ]);
  });
  it('asks for the last 20 hours only, newest first, and only the three fields', async () => {
    const f = fake({ attendances: rows });
    await source(f).attendance(now);
    const u = f.calls[0].url;
    expect(u.searchParams.get('select')).toBe('employee_id,clock_in,clock_out');
    expect(u.searchParams.get('clock_in')).toBe('gte.2026-10-09 12:00:00');
    expect(u.searchParams.get('order')).toBe('clock_in.desc');
  });
  it('failing to read it is a SourceError', async () => {
    expect(await source(fake({ attendances: 500 })).attendance(now).catch(e => e)).toBeInstanceOf(SourceError);
  });
});
