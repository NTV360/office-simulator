import { deskSeat, fromDbUtc, normalizeSpec, type AttendanceRecord, type Shift } from '@office/shared';
import type { ImportedEmployee } from './employee-store';

// Reads the company's employee records (Supabase, through its REST interface) for the server to import. Read only, with the server-only secret
// key, which never leaves this process (not logged, not sent to a browser). Only names, departments, shifts, looks and desks are taken;
// everything else in those tables (contact details, birth dates, RFID values, access roles) is never selected. Whatever comes back is
// treated as untrusted: ids must be UUIDs, text is trimmed and capped, looks are made valid, a malformed row is skipped.
// (This is `main`'s server/routes/employees.js and attendance.js, over fetch instead of the Supabase client.)

export class SourceError extends Error {
  constructor(message: string) { super(message); this.name = 'SourceError'; }
}

export interface SourceConfig {
  url: string;
  secretKey: string;
  /** For tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: { warn(msg: string): void };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;
const MAX_ROWS = 20_000;
/** Employment types whose code or description says intern / OJT / trainee. */
const INTERN = /intern|ojt|trainee/i;
/** How far back attendance is read: long enough to cover a night shift that started yesterday. */
export const ATTENDANCE_WINDOW_HOURS = 20;

// control characters, zero-width and bidi marks: never part of a name (a NUL makes the database refuse the row, the others fool the eye)
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(INVISIBLE, '').trim().slice(0, max).trim();
  return t === '' ? null : t;
};
/** Where a plain http address is fine: this machine (the key never crosses a network). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);
const minutes = (t: unknown): number | null => {
  if (typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
};

interface Row { [key: string]: unknown }

export class SupabaseSource {
  private readonly base: string;
  private readonly key: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log: { warn(msg: string): void };

  constructor(cfg: SourceConfig) {
    let u: URL;
    try { u = new URL(cfg.url); } catch { throw new SourceError('SUPABASE_URL is not a web address'); }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) throw new SourceError('SUPABASE_URL must start with https:// (the secret key is sent with every request)');
    if (!cfg.secretKey || /\s/.test(cfg.secretKey)) throw new SourceError('SUPABASE_SECRET_KEY is missing or has spaces in it');
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}/rest/v1`;
    this.key = cfg.secretKey;
    this.doFetch = cfg.fetch ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
    this.log = cfg.log ?? { warn: () => {} };
  }

  /** Every row of a table, `query` being the PostgREST filter text after the table name. Pages of 1000 (the interface's own limit). */
  private async rows(table: string, query: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let res: Response;
      try {
        res = await this.doFetch(`${this.base}/${table}?${query}`, {
          headers: { apikey: this.key, authorization: `Bearer ${this.key}`, accept: 'application/json', 'range-unit': 'items', range: `${from}-${from + PAGE - 1}` },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'error', // the key is in the headers: never follow it to another host
        });
      } catch (err) {
        throw new SourceError(`${table}: could not reach the employee records (${err instanceof Error ? err.name : 'error'})`);
      }
      if (res.status === 416 && from > 0) return out; // the rows ended exactly on a page: there is no next page
      if (!res.ok && res.status !== 206) throw new SourceError(`${table}: the employee records answered ${res.status}`);
      let body: unknown;
      try { body = await res.json(); } catch { throw new SourceError(`${table}: the answer was not JSON`); }
      if (!Array.isArray(body)) throw new SourceError(`${table}: the answer was not a list`);
      out.push(...body.filter((r): r is Row => typeof r === 'object' && r !== null && !Array.isArray(r)));
      if (body.length < PAGE) return out;
      if (out.length >= MAX_ROWS) throw new SourceError(`${table}: more than ${MAX_ROWS} rows; refusing to take part of the list for all of it`);
    }
  }

  /** A table we can do without (the answer carries on with defaults), as main does for an unreadable table. */
  private async optional(table: string, query: string, what: string): Promise<Row[]> {
    try { return await this.rows(table, query); } catch (err) {
      this.log.warn(`${table} unreadable, ${what}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** The active employees, with department, shift, intern flag, saved look and chosen desk. */
  async employees(): Promise<ImportedEmployee[]> {
    const people = await this.rows('employees', 'select=user_id,first_name,last_name,employment_type_id,shift_id,department:departments(name)&deleted_at=is.null&order=first_name.asc');
    // (required: if they could not be read, every stored shift and intern flag would be reset to the defaults)
    const types = await this.rows('employment_types', 'select=employment_type_id,code,description');
    const shiftRows = await this.rows('shifts', 'select=shift_id,code,start_time,end_time');
    const looks = await this.optional('character_information', 'select=user_id,character_data', 'made-up looks used');
    const interns = new Set(types.filter(t => INTERN.test(`${String(t.code ?? '')} ${String(t.description ?? '')}`)).map(t => String(t.employment_type_id)));
    const shifts = new Map<string, Shift>();
    for (const s of shiftRows) {
      const start = minutes(s.start_time), end = minutes(s.end_time), code = text(s.code, 20);
      if (start !== null && end !== null && code && s.shift_id !== null && s.shift_id !== undefined) shifts.set(String(s.shift_id), { code, start, end });
    }
    const lookOf = new Map<string, unknown>();
    for (const l of looks) if (typeof l.user_id === 'string' && UUID.test(l.user_id) && l.character_data && typeof l.character_data === 'object') lookOf.set(l.user_id.toLowerCase(), l.character_data);

    const out: ImportedEmployee[] = [], seen = new Set<string>();
    let skipped = 0;
    for (const e of people) {
      const id = typeof e.user_id === 'string' && UUID.test(e.user_id) ? e.user_id.toLowerCase() : null;
      const first = text(e.first_name, 100), last = text(e.last_name, 100) ?? '';
      if (!id || !first || seen.has(id)) { skipped++; continue; }
      seen.add(id);
      const dept = typeof e.department === 'object' && e.department !== null ? text((e.department as Row).name, 80) : null;
      const raw = lookOf.get(id);
      // a desk named in the record counts only where this department may sit (the rule the admin route enforces)
      const seat = raw ? deskSeat((raw as Row).desk as string) : null;
      const desk = seat && (!seat.island.department || seat.island.department === dept) ? seat.id : null;
      out.push({
        userId: id, firstName: first, lastName: last, department: dept,
        intern: e.employment_type_id !== null && e.employment_type_id !== undefined && interns.has(String(e.employment_type_id)),
        shift: e.shift_id !== null && e.shift_id !== undefined ? shifts.get(String(e.shift_id)) ?? null : null,
        character: raw ? normalizeSpec(raw) : null,
        desk,
      });
    }
    if (skipped) this.log.warn(`${skipped} employee record${skipped === 1 ? '' : 's'} skipped (no valid id or name)`);
    return out;
  }

  /** Each employee's latest attendance from the last 20 hours: who is clocked in (no clock-out), who has gone home. */
  async attendance(now: Date = new Date()): Promise<AttendanceRecord[]> {
    const since = new Date(now.getTime() - ATTENDANCE_WINDOW_HOURS * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const data = await this.rows('attendances', `select=employee_id,clock_in,clock_out&clock_in=gte.${encodeURIComponent(since)}&order=clock_in.desc`);
    const latest = new Map<string, Row>();
    for (const a of data) {
      const id = typeof a.employee_id === 'string' && UUID.test(a.employee_id) ? a.employee_id.toLowerCase() : null;
      if (id && !latest.has(id)) latest.set(id, a);
    }
    const iso = (v: unknown): string | null => { const d = typeof v === 'string' ? fromDbUtc(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
    return [...latest].map(([userId, a]) => ({ userId, clockIn: iso(a.clock_in), clockOut: iso(a.clock_out) }));
  }
}
