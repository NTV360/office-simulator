import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SaveError, hasSlot, interactables, people, setStaffCount, sim, simEvents, type SavedWorld } from '@office/shared';
import type { Settings, SettingsUpdate } from '../admin/settings';
import { DbService } from '../db.service';
import { runMigrations } from '../db/migrate';
import { WorldStore } from '../db/world-store';
import { Persistence, loadForBoot, type PersistenceStatus } from './persistence';
import { World, readWorldOptions, type WorldStatus } from './world';

/** Owns the one World of this process: restores it from the database (or starts fresh), runs its tick loop, saves it, stops it on shutdown. */
@Injectable()
export class WorldService implements OnApplicationBootstrap, OnApplicationShutdown {
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
    const boot = await this.boot();
    this.world.start();
    const s = this.world.status();
    this.log.log(`world running: ${s.staff} staff at ${s.tickRate} Hz, speed ${s.speed}${s.paused ? ' (paused)' : ''}, ${this.restored ? 'restored from the database' : 'fresh'}`);
    if (boot.store && this.persistence.status.enabled) {
      const every = Number(process.env.SAVE_INTERVAL_MS) || 10_000;
      this.saveTimer = setInterval(() => { if (!this.persistence.busy) void this.persistence.saveNow(); }, every);
    }
    this.readyResolve();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.saveTimer) clearInterval(this.saveTimer);
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

    let saved = boot.saved;
    try {
      this.world.init(saved);
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
    return { slots: people.filter(hasSlot).length, maxSlots: interactables.of('desk').length, speed: sim.speed, paused: sim.paused, tickRate: this.world.options.tickRate };
  }

  /** Apply an admin's change, save it straight away, and return the settings as they now stand. Viewers see it in the next snapshots. */
  async applySettings(update: SettingsUpdate): Promise<Settings> {
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

  status(): WorldStatus & { persistence: PersistenceStatus } {
    const s = { ...this.persistence.status, restored: this.restored };
    return { ...this.world.status(), persistence: s };
  }
}
