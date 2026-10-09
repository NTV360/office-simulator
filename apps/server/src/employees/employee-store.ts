import type { Pool } from 'pg';
import type { Shift } from '@office/shared';

// The staff list in storage: PostgreSQL in production, a Map in the fast tests (the same behaviour). The company's employee records are
// the source for who is in the office, their names, departments and shifts; the look and the desk someone chooses are kept here and an
// import never overwrites them. See docs/PHASE-6-BREAKDOWN.md, step 4.

export interface EmployeeRecord {
  userId: string;
  firstName: string;
  lastName: string;
  department: string | null;
  intern: boolean;
  shift: Shift | null;
  /** The look chosen here (already normalised), or null. */
  character: unknown | null;
  /** The seat id chosen here ('A3'), or null: any free desk. */
  desk: string | null;
  /** No longer in the company's records. */
  removed: boolean;
}

/** One employee as the source describes them. */
export interface ImportedEmployee {
  userId: string;
  firstName: string;
  lastName: string;
  department: string | null;
  intern: boolean;
  shift: Shift | null;
  /** Their look in the source: used only for an employee who has none here yet (already normalised). */
  character: unknown | null;
  /** Their desk in the source: used only for an employee who has none here yet, and only if it is free. */
  desk: string | null;
}

export interface ImportResult { added: number; updated: number; removed: number; restored: number }

export interface EmployeeStore {
  /** Everyone still in the company's records, by first then last name. */
  list(): Promise<EmployeeRecord[]>;
  /** One employee (including one that was removed), or null. */
  byId(userId: string): Promise<EmployeeRecord | null>;
  /**
   * Bring the list in line with the source: new people are added (with their look and desk from the source), existing people get their
   * name, department, intern flag and shift updated (their look and desk stay as chosen here, unless they had none), people who
   * were removed and are back are restored, and people no longer in the source are marked removed.
   */
  applyImport(list: readonly ImportedEmployee[]): Promise<ImportResult>;
  /** Remember the look chosen here (already normalised). False if there is no such employee. */
  setCharacter(userId: string, spec: unknown): Promise<boolean>;
  /** Choose a desk (a seat id) or none. 'taken' if another employee chose it, 'missing' if there is no such employee. */
  setDesk(userId: string, desk: string | null): Promise<'ok' | 'taken' | 'missing'>;
}

const sameShift = (a: Shift | null, b: Shift | null): boolean => (a === null || b === null ? a === b : a.code === b.code && a.start === b.start && a.end === b.end);

interface Row {
  user_id: string; first_name: string; last_name: string; department: string | null; intern: boolean; shift: Shift | null; character: unknown | null; desk: string | null; removed: boolean;
}
const toRecord = (r: Row): EmployeeRecord => ({
  userId: r.user_id, firstName: r.first_name, lastName: r.last_name, department: r.department, intern: r.intern, shift: r.shift, character: r.character, desk: r.desk, removed: r.removed,
});

export class PgEmployeeStore implements EmployeeStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<EmployeeRecord[]> {
    const r = await this.pool.query<Row>('SELECT * FROM employees WHERE NOT removed ORDER BY lower(first_name), lower(last_name), user_id');
    return r.rows.map(toRecord);
  }

  async byId(userId: string): Promise<EmployeeRecord | null> {
    const r = await this.pool.query<Row>('SELECT * FROM employees WHERE user_id = $1', [userId]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async applyImport(list: readonly ImportedEmployee[]): Promise<ImportResult> {
    const out: ImportResult = { added: 0, updated: 0, removed: 0, restored: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const have = new Map((await client.query<Row>('SELECT * FROM employees FOR UPDATE')).rows.map(r => [r.user_id, r]));
      const taken = new Set([...have.values()].filter(r => !r.removed && r.desk).map(r => r.desk as string));
      for (const e of list) {
        const old = have.get(e.userId);
        // a desk from the source only if nobody here has it
        const seedDesk = e.desk && !taken.has(e.desk) ? e.desk : null;
        if (!old) {
          await client.query('INSERT INTO employees (user_id, first_name, last_name, department, intern, shift, character, desk) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [e.userId, e.firstName, e.lastName, e.department, e.intern, e.shift === null ? null : JSON.stringify(e.shift), e.character === null ? null : JSON.stringify(e.character), seedDesk]);
          if (seedDesk) taken.add(seedDesk);
          out.added++;
          continue;
        }
        const desk = old.desk ?? seedDesk;
        const character = old.character ?? e.character;
        if (desk && desk !== old.desk) taken.add(desk);
        const changed = old.removed || old.first_name !== e.firstName || old.last_name !== e.lastName || old.department !== e.department || old.intern !== e.intern
          || !sameShift(old.shift, e.shift) || desk !== old.desk || (old.character === null && character !== null);
        if (!changed) continue;
        await client.query('UPDATE employees SET first_name = $2, last_name = $3, department = $4, intern = $5, shift = $6, character = $7, desk = $8, removed = false, updated_at = now() WHERE user_id = $1',
          [e.userId, e.firstName, e.lastName, e.department, e.intern, e.shift === null ? null : JSON.stringify(e.shift), character === null ? null : JSON.stringify(character), desk]);
        if (old.removed) out.restored++; else out.updated++;
      }
      const inList = new Set(list.map(e => e.userId));
      for (const old of have.values()) {
        if (old.removed || inList.has(old.user_id)) continue;
        await client.query('UPDATE employees SET removed = true, updated_at = now() WHERE user_id = $1', [old.user_id]);
        out.removed++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
    return out;
  }

  async setCharacter(userId: string, spec: unknown): Promise<boolean> {
    const r = await this.pool.query('UPDATE employees SET character = $2, updated_at = now() WHERE user_id = $1', [userId, JSON.stringify(spec)]);
    return (r.rowCount ?? 0) > 0;
  }

  async setDesk(userId: string, desk: string | null): Promise<'ok' | 'taken' | 'missing'> {
    try {
      const r = await this.pool.query('UPDATE employees SET desk = $2, updated_at = now() WHERE user_id = $1', [userId, desk]);
      return (r.rowCount ?? 0) === 0 ? 'missing' : 'ok';
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return 'taken';
      throw err;
    }
  }
}

/** A store that lives in memory: the same behaviour, for fast tests. */
export class MemoryEmployeeStore implements EmployeeStore {
  readonly rows = new Map<string, EmployeeRecord>();

  async list(): Promise<EmployeeRecord[]> {
    return [...this.rows.values()].filter(r => !r.removed).sort((a, b) => a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase()) || a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase()) || (a.userId < b.userId ? -1 : 1)).map(r => ({ ...r }));
  }
  async byId(userId: string): Promise<EmployeeRecord | null> { const r = this.rows.get(userId); return r ? { ...r } : null; }

  async applyImport(list: readonly ImportedEmployee[]): Promise<ImportResult> {
    const out: ImportResult = { added: 0, updated: 0, removed: 0, restored: 0 };
    const taken = new Set([...this.rows.values()].filter(r => !r.removed && r.desk).map(r => r.desk as string));
    for (const e of list) {
      const old = this.rows.get(e.userId);
      const seedDesk = e.desk && !taken.has(e.desk) ? e.desk : null;
      if (!old) {
        this.rows.set(e.userId, { userId: e.userId, firstName: e.firstName, lastName: e.lastName, department: e.department, intern: e.intern, shift: e.shift, character: e.character, desk: seedDesk, removed: false });
        if (seedDesk) taken.add(seedDesk);
        out.added++;
        continue;
      }
      const desk = old.desk ?? seedDesk, character = old.character ?? e.character;
      if (desk && desk !== old.desk) taken.add(desk);
      const changed = old.removed || old.firstName !== e.firstName || old.lastName !== e.lastName || old.department !== e.department || old.intern !== e.intern
        || !sameShift(old.shift, e.shift) || desk !== old.desk || (old.character === null && character !== null);
      if (!changed) continue;
      this.rows.set(e.userId, { ...old, firstName: e.firstName, lastName: e.lastName, department: e.department, intern: e.intern, shift: e.shift, character, desk, removed: false });
      if (old.removed) out.restored++; else out.updated++;
    }
    const inList = new Set(list.map(e => e.userId));
    for (const old of this.rows.values()) {
      if (old.removed || inList.has(old.userId)) continue;
      old.removed = true; out.removed++;
    }
    return out;
  }

  async setCharacter(userId: string, spec: unknown): Promise<boolean> {
    const r = this.rows.get(userId);
    if (!r) return false;
    r.character = spec;
    return true;
  }

  async setDesk(userId: string, desk: string | null): Promise<'ok' | 'taken' | 'missing'> {
    const r = this.rows.get(userId);
    if (!r) return 'missing';
    if (desk !== null && [...this.rows.values()].some(x => x.userId !== userId && !x.removed && x.desk === desk)) return 'taken';
    r.desk = desk;
    return 'ok';
  }
}
