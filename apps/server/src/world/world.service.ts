import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Inject, Injectable, Logger, BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { SaveError, hasSlot, interactables, live, people, resetDay, setMode, setStaffCount, sim, simEvents, type SavedWorld } from '@office/shared';
import type { Settings, SettingsUpdate } from '../admin/settings';
import { DbService } from '../db.service';
import { runMigrations } from '../db/migrate';
import { WorldStore } from '../db/world-store';
import { PgEmployeeStore } from '../employees/employee-store';
import { setRoster, syncRoster } from '../employees/roster-sync';
import { loadPhysics, type StaticShape } from '../physics/physics';
import officeShapes from '../physics/office-shapes.json';
import { Persistence, loadForBoot, type PersistenceStatus } from './persistence';
import { World, readWorldOptions, type WorldStatus } from './world';

/** Owns the one World of this process: restores it from the database (or starts fresh), runs its tick loop, saves it, stops it on shutdown. */
const LOOP_RESOLUTION_MS = 10;

@Injectable()
export class WorldService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly world = new World(readWorldOptions(process.env));
  private readonly log = new Logger('World');
  private persistence = new Persistence(null, this.log);
  private restored = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private readyResolve!: () => void;
  /** Resolves when the world is built (restored or fresh) and ticking. */
  readonly ready = new Promise<void>(res => { this.readyResolve = res; });

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.world.options.physics !== false) { await loadPhysics(); this.world.usePhysics(officeShapes as unknown as StaticShape[]); }
    else this.log.warn('PHYSICS=off: items do not fall or slide');
    const boot = await this.boot();
    this.loop.enable();
    this.world.start();
    const s = this.world.status();
    this.log.log(`world running: ${s.staff} staff at ${s.tickRate} Hz, speed ${s.speed}${s.paused ? ' (paused)' : ''}, ${this.restored ? 'restored from the database' : 'fresh'}`);
    if (boot.store && this.persistence.status.enabled) {
      const every = Number(process.env.SAVE_INTERVAL_MS) || 10_000;
      this.saveTimer = setInterval(() => { if (!this.persistence.busy) void this.persistence.saveNow(); }, every);
    }
    this.readyResolve();
  }

  /**
   * The last save, on the way out. It has to come before the database connection is closed, and that happens in `DbService.onApplicationShutdown` (the last phase);
   * this is `beforeApplicationShutdown`, which Nest runs first. (When the save lived in `onApplicationShutdown` next to a pool closed in `onModuleDestroy`, it failed
   * with "Cannot use a pool after calling end on the pool", and a restart lost whatever had changed since the last timed save.)
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.loop.disable();
    this.world.stop();
    await this.persistence.saveNow(); // the last state, so a restart continues from here
  }

  /** Read the save (if any), build the world from it, and only then switch saving on. */
  private async boot(): Promise<{ store: object | null }> {
    const pool = this.db.pool;
    if (!pool) { this.world.init(null); this.persistence.disable('no DATABASE_URL'); return { store: null }; }
    const reset = process.env.RESET_WORLD === 'true';
    if (reset) this.log.warn('RESET_WORLD is set: the saved world will be replaced by a fresh one');

    const boot = await loadForBoot(async () => {
      const applied = await runMigrations(pool);
      if (applied.length) this.log.log(`database migrations applied: ${applied.join(', ')}`);
      const store = new WorldStore(pool);
      return reset ? { load: async () => null, save: (w: SavedWorld) => store.save(w) } : store;
    }, this.log);

    if (!boot.store) { this.world.init(null); this.persistence.disable(boot.reason ?? 'database unavailable'); return { store: null }; }

    // the staff list (from the employee records, as last imported): the office is made of it
    let staff: Awaited<ReturnType<PgEmployeeStore['list']>> = [];
    try { staff = await new PgEmployeeStore(pool).list(); } catch (err) { this.log.error(`could not read the staff list: ${err instanceof Error ? err.message : String(err)}; made-up staff are used`); }
    setRoster(staff);

    let saved = boot.saved;
    try {
      this.world.init(saved);
      if (saved && staff.length) { const r = syncRoster(staff); if (r.added || r.removed || r.updated || r.replaced) this.log.log(`staff list applied to the saved world: ${r.added} in, ${r.removed} out, ${r.updated} changed, ${r.replaced} made-up replaced`); }
    } catch (err) {
      if (!(err instanceof SaveError)) throw err;
      // The save is readable but this office cannot be built from it (for example a desk it names no longer exists).
      // Leave the save exactly as it is, run a fresh world, and do not save over it until someone has looked.
      this.log.error(`the saved world cannot be restored: ${err.message}. Running a fresh world WITHOUT saving; the save has been left untouched.`);
      saved = null;
      this.world.init(null);
      this.persistence.disable(`the saved world cannot be restored: ${err.message}`);
      return { store: null };
    }
    this.restored = saved !== null;
    this.persistence = new Persistence(boot.store, this.log);
    return { store: boot.store };
  }

  /** The settings an admin can change, as they are now. */
  settings(): Settings {
    return { slots: people.filter(hasSlot).length, maxSlots: interactables.of('desk').length, speed: sim.speed, paused: sim.paused, tickRate: this.world.options.tickRate, clockMode: live.mode, attendance: live.attendance };
  }

  /** Apply an admin's change, save it straight away, and return the settings as they now stand. Viewers see it in the next snapshots. */
  async applySettings(update: SettingsUpdate): Promise<Settings> {
    if (update.clockMode !== undefined) { setMode(update.clockMode, update.simStart ?? 'day'); resetDay(); } // (everyone is seated as the new clock says)
    if (update.speed !== undefined) sim.speed = update.speed;
    if (update.paused !== undefined) sim.paused = update.paused;
    if (update.slots !== undefined) setStaffCount(update.slots);
    this.log.log(`admin changed settings: ${JSON.stringify(update)}`);
    await this.persistence.saveNow(); // waits for any save in progress and then saves again, so this change is in the database
    return this.settings();
  }

  /** Show a message to everyone connected. */
  announce(text: string): void {
    this.log.log(`admin announcement: ${text}`);
    simEvents.emit('announce', text);
  }

  /** How late the event loop has been since the window was last emptied (`GET /api/world?fresh=1` empties it: a load test does that before it starts). */
  private readonly loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });

  /** The process: memory and the event loop (the budgets in the plan, section 14). */
  private processStats(fresh: boolean): { rssMb: number; heapMb: number; eventLoopP99Ms: number; eventLoopMaxMs: number } {
    const m = process.memoryUsage();
    // (the histogram records the whole time between two 10 ms timer ticks: what is over 10 ms is how late the loop was)
    const late = (ns: number): number => Math.max(0, Math.round((ns / 1e6 - LOOP_RESOLUTION_MS) * 100) / 100);
    const out = { rssMb: Math.round(m.rss / 1048576 * 10) / 10, heapMb: Math.round(m.heapUsed / 1048576 * 10) / 10, eventLoopP99Ms: late(this.loop.percentile(99)), eventLoopMaxMs: late(this.loop.max) };
    if (fresh) this.loop.reset(); // (only when asked: whoever else looks at this page must not empty the window for a test that is reading it)
    return out;
  }

  status(fresh = false): WorldStatus & { persistence: PersistenceStatus; process: ReturnType<WorldService['processStats']> } {
    const s = { ...this.persistence.status, restored: this.restored };
    return { ...this.world.status(), persistence: s, process: this.processStats(fresh) };
  }
}
