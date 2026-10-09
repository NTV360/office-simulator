import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { interactables, isStaff, people, serializeWorld, setStaffCount, sim, simEvents, type SavedWorld } from '@office/shared';
import type { Settings, SettingsUpdate } from '../admin/settings';
import { DbService } from '../db.service';
import { runMigrations } from '../db/migrate';
import { WorldStore } from '../db/world-store';
import { World, readWorldOptions, type WorldStatus } from './world';

export interface PersistenceStatus {
  /** Whether the world is being saved. False without a database, or if the database was unreachable at start-up. */
  enabled: boolean;
  /** Why it is off, if it is. */
  reason?: string;
  restored: boolean;
  saves: number;
  lastSavedAt: string | null;
  lastError: string | null;
}

const BOOT_ATTEMPTS = 10;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Owns the one World of this process: restores it from the database (or starts fresh), runs its tick loop, saves it, stops it on shutdown. */
@Injectable()
export class WorldService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly world = new World(readWorldOptions(process.env));
  private readonly log = new Logger('World');
  private store: WorldStore | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> | null = null;
  private readonly persistence: PersistenceStatus = { enabled: false, restored: false, saves: 0, lastSavedAt: null, lastError: null };

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async onApplicationBootstrap(): Promise<void> {
    const saved = await this.loadSaved();
    this.world.init(saved);
    this.world.start();
    const s = this.world.status();
    this.log.log(`world running: ${s.staff} staff at ${s.tickRate} Hz, speed ${s.speed}${s.paused ? ' (paused)' : ''}, ${this.persistence.restored ? 'restored from the database' : 'fresh'}`);
    if (this.store) {
      const every = Number(process.env.SAVE_INTERVAL_MS) || 10_000;
      this.saveTimer = setInterval(() => { void this.saveNow(); }, every);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.world.stop();
    await this.saveNow(); // the last state, so a restart continues from here
  }

  /** Read the saved world, if there is a database. Saving is only switched on once this has worked (see below). */
  private async loadSaved(): Promise<SavedWorld | null> {
    const pool = this.db.pool;
    if (!pool) { this.persistence.reason = 'no DATABASE_URL'; return null; }
    if (process.env.RESET_WORLD === 'true') this.log.warn('RESET_WORLD is set: the saved world will be replaced by a fresh one');
    let lastErr: unknown;
    for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
      try {
        const applied = await runMigrations(pool);
        if (applied.length) this.log.log(`database migrations applied: ${applied.join(', ')}`);
        const store = new WorldStore(pool);
        let saved: SavedWorld | null = null;
        if (process.env.RESET_WORLD !== 'true') {
          try { saved = await store.load(); } catch (err) { this.log.error(String(err instanceof Error ? err.message : err)); }
        }
        this.store = store;
        this.persistence.enabled = true;
        this.persistence.restored = saved !== null;
        return saved;
      } catch (err) {
        lastErr = err;
        this.log.warn(`database not ready (attempt ${attempt}/${BOOT_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`);
        await sleep(2000);
      }
    }
    // Never save over a world we could not read: starting fresh and saving later could destroy the real one.
    this.persistence.reason = `database unreachable at start-up: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
    this.log.error(`${this.persistence.reason}. Running WITHOUT saving; restart the server once the database is back.`);
    return null;
  }

  /** The settings an admin can change, as they are now. */
  settings(): Settings {
    return { slots: people.filter(isStaff).length, maxSlots: interactables.of('desk').length, speed: sim.speed, paused: sim.paused, tickRate: this.world.options.tickRate };
  }

  /** Apply an admin's change, save it straight away, and return the settings as they now stand. Viewers see it in the next snapshots. */
  async applySettings(update: SettingsUpdate): Promise<Settings> {
    if (update.speed !== undefined) sim.speed = update.speed;
    if (update.paused !== undefined) sim.paused = update.paused;
    if (update.slots !== undefined) setStaffCount(update.slots);
    this.log.log(`admin changed settings: ${JSON.stringify(update)}`);
    await this.saveNow();
    return this.settings();
  }

  /** Show a message to everyone connected. */
  announce(text: string): void {
    this.log.log(`admin announcement: ${text}`);
    simEvents.emit('announce', text);
  }

  /** Save the world now. One save at a time; a failure is recorded and logged, never thrown. */
  saveNow(): Promise<void> {
    if (!this.store) return Promise.resolve();
    if (this.saving) return this.saving;
    const store = this.store;
    this.saving = (async () => {
      try {
        await store.save(serializeWorld());
        this.persistence.saves++;
        this.persistence.lastSavedAt = new Date().toISOString();
        this.persistence.lastError = null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.persistence.lastError !== msg) this.log.error(`saving the world failed: ${msg}`);
        this.persistence.lastError = msg;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  status(): WorldStatus & { persistence: PersistenceStatus } {
    return { ...this.world.status(), persistence: { ...this.persistence } };
  }
}
