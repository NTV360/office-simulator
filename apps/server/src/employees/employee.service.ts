import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { allocateDesks, applyAttendance, hasSlot, interactables, live, people, type AttendanceRecord } from '@office/shared';
import { DbService } from '../db.service';
import { WorldService } from '../world/world.service';
import { PlayService } from '../play/play.service';
import { PgEmployeeStore, type EmployeeStore, type ImportResult } from './employee-store';
import { syncRoster, type SyncResult } from './roster-sync';
import { SourceError, SupabaseSource } from './supabase-source';

/** What the last import and the last attendance read did, for the admin page. */
export interface ImportStatus {
  /** Is there a source of employee records (SUPABASE_URL and SUPABASE_SECRET_KEY)? */
  configured: boolean;
  lastImportAt: string | null;
  lastImportOk: boolean | null;
  lastImportError: string | null;
  lastResult: (ImportResult & { sync: SyncResult }) | null;
  lastAttendanceAt: string | null;
  lastAttendanceOk: boolean | null;
  lastAttendanceError: string | null;
  attendanceRecords: number;
}

/** Below this many stored employees a short list is believed. */
const SHRINK_FLOOR = 6;
const DEFAULT_IMPORT_MS = 10 * 60_000;
const DEFAULT_ATTENDANCE_MS = 60_000;

/**
 * The staff list: owns the employee store, imports the company's employee records into it (at start-up and every few minutes, never waiting
 * for them: a failed import changes nothing and is tried again), keeps the running office in line with the list, and in Live mode keeps
 * who is clocked in current. See docs/PHASE-6-BREAKDOWN.md, step 4.
 */
@Injectable()
export class EmployeeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private store: EmployeeStore | null = null;
  private source: SupabaseSource | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private timers: NodeJS.Timeout[] = [];
  private readonly log = new Logger('Employees');
  readonly status: ImportStatus = {
    configured: false, lastImportAt: null, lastImportOk: null, lastImportError: null, lastResult: null,
    lastAttendanceAt: null, lastAttendanceOk: null, lastAttendanceError: null, attendanceRecords: 0,
  };

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(PlayService) private readonly play: PlayService,
  ) {}

  /** The store, or a 503 when the server has no database. */
  require(): EmployeeStore {
    if (!this.store) throw new ServiceUnavailableException('the staff list is not available: the server has no database');
    return this.store;
  }
  get available(): boolean { return this.store !== null; }

  /** Use this store instead of the database one (tests). */
  useStore(store: EmployeeStore): void { this.store = store; }
  /** Use this source of employee records (tests, or null for none). */
  useSource(source: SupabaseSource | null): void { this.source = source; this.status.configured = source !== null; }

  async onApplicationBootstrap(): Promise<void> {
    await this.worlds.ready;
    const pool = this.db.pool;
    if (pool && !this.store) this.store = new PgEmployeeStore(pool);
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!this.source && url && key) {
      try { this.useSource(new SupabaseSource({ url, secretKey: key, log: this.log })); } catch (err) { this.log.error(`the employee records are not used: ${err instanceof Error ? err.message : String(err)}`); }
    } else if (!this.source) this.log.log('no SUPABASE_URL / SUPABASE_SECRET_KEY: the staff list is not imported (what is stored stays as it is)');
    if (!this.source || !this.store) return;
    // first reads at start-up, without holding the server up; then on a timer
    void this.importNow().catch(() => {}); // (the failure is already logged and in the status)
    void this.refreshAttendance().catch(() => {});
    const every = Number(process.env.EMPLOYEE_IMPORT_MS) || DEFAULT_IMPORT_MS, att = Number(process.env.ATTENDANCE_MS) || DEFAULT_ATTENDANCE_MS;
    this.timers.push(setInterval(() => { void this.importNow().catch(() => {}); }, every));
    // Keep the latest attendance ready before Live is selected as well. This avoids a mode switch
    // racing the next poll and briefly showing the previous simulated schedule.
    this.timers.push(setInterval(() => { void this.refreshAttendance().catch(() => {}); }, att));
  }

  onApplicationShutdown(): void { this.timers.forEach(clearInterval); this.timers = []; }

  /** Run `job` after whatever is running (imports and syncs never overlap). */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.running.then(job, job);
    this.running = run.catch(() => {});
    return run;
  }

  /**
   * Read the employee records, bring the stored list in line with them, and the office in line with the list. A failed read changes nothing;
   * a successful empty response is authoritative and produces an empty active roster. Resolves with what was done.
   */
  importNow(opts: { force?: boolean } = {}): Promise<ImportResult & { sync: SyncResult }> {
    return this.serial(async () => {
      if (!this.source) throw new SourceError('no source of employee records is configured (SUPABASE_URL and SUPABASE_SECRET_KEY)');
      const store = this.require();
      try {
        const list = await this.source.employees();
        // A successful source response is authoritative, including an empty roster.
        // Transport/shape failures are rejected before this point and leave the last roster intact.
        if (list.length === 0) {
          const result = await store.applyImport(list);
          const sync = syncRoster(await this.canonicalRecords(store));
          await this.play.reconcile();
          const out = { ...result, sync };
          this.status.lastImportAt = new Date().toISOString(); this.status.lastImportOk = true; this.status.lastImportError = null; this.status.lastResult = out;
          return out;
        }
        // a much shorter list than the one stored is more likely a partial answer than half the company leaving: an admin can still force it
        const stored = (await store.list()).length;
        if (!opts.force && stored >= SHRINK_FLOOR && list.length < stored / 2) throw new SourceError(`the employee records list ${list.length} people where ${stored} are stored; nothing was changed (an admin can import anyway)`);
        const result = await store.applyImport(list);
        const sync = syncRoster(await this.canonicalRecords(store));
        await this.play.reconcile();
        const out = { ...result, sync };
        this.status.lastImportAt = new Date().toISOString(); this.status.lastImportOk = true; this.status.lastImportError = null; this.status.lastResult = out;
        if (result.added || result.updated || result.removed || result.restored) this.log.log(`employee records imported: ${result.added} new, ${result.updated} changed, ${result.removed} gone, ${result.restored} back; the office: ${sync.added} in, ${sync.removed} out, ${sync.updated} changed, ${sync.replaced} made-up replaced`);
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status.lastImportAt = new Date().toISOString(); this.status.lastImportOk = false; this.status.lastImportError = message;
        this.log.warn(`employee import failed (the staff list is unchanged): ${message}`);
        throw err;
      }
    });
  }

  /** Persist stable desk choices before rebuilding the in-memory office. */
  private async canonicalRecords(store: EmployeeStore): Promise<Awaited<ReturnType<EmployeeStore['list']>>> {
    const records = await store.list();
    const ids = new Set(records.map(r => r.userId));
    const owned = new Map(records.map(r => [r.userId, people.find(p => p.userId === r.userId && hasSlot(p) && p.owner !== undefined)]));
    const blocked = people
      .filter(p => hasSlot(p) && p.owner !== undefined && (!p.userId || !ids.has(p.userId)))
      .map(p => p.slot?.deskId)
      .filter((id): id is string => !!id);
    const inputs = records.map(r => ({
      userId: r.userId,
      department: r.department,
      desk: owned.get(r.userId)?.slot?.deskId ?? r.desk,
    }));
    const allocations = allocateDesks(
      inputs,
      interactables.of('desk').map(s => ({ deskId: s.deskId!, department: s.department })),
      blocked,
    );
    const changes = new Map<string, string | null>();
    for (const record of records) {
      const desired = allocations.get(record.userId) ?? null;
      if (desired !== record.desk) changes.set(record.userId, desired);
    }
    if (changes.size) {
      await store.setDeskAssignments(changes);
      return store.list();
    }
    return records;
  }

  /** Bring the office in line with the stored list (after an admin changed something about an employee). */
  syncWorld(): Promise<SyncResult> {
    return this.serial(async () => {
      const store = this.require();
      const result = syncRoster(await this.canonicalRecords(store));
      await this.play.reconcile();
      return result;
    });
  }

  /** Who is clocked in right now, from the records. Without a source there is nothing to read. */
  refreshAttendance(now: Date = new Date()): Promise<number> {
    return this.serial(async () => {
      if (!this.source) return 0;
      try {
        const records: AttendanceRecord[] = await this.source.attendance(now);
        live.attendance = true; // attendance is readable: Live follows it
        applyAttendance(records);
        this.status.lastAttendanceAt = new Date().toISOString(); this.status.lastAttendanceOk = true; this.status.lastAttendanceError = null; this.status.attendanceRecords = records.length;
        return records.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status.lastAttendanceAt = new Date().toISOString(); this.status.lastAttendanceOk = false; this.status.lastAttendanceError = message;
        this.log.warn(`attendance could not be read (the last known is kept): ${message}`);
        throw err;
      }
    });
  }
}
