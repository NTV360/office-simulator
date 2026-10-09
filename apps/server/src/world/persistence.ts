import { SaveError, parseSavedWorld, serializeWorld, type SavedWorld } from '@office/shared';

// The rules for saving the world, apart from Nest and PostgreSQL so they can be tested with fakes.
// The one rule behind all of them: never replace a good save with something worse.

export interface StoreLike {
  load(): Promise<SavedWorld | null>;
  save(world: SavedWorld): Promise<void>;
}
export interface LoggerLike {
  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface PersistenceStatus {
  /** Whether the world is being saved. False without a database, or when saving could be unsafe (see `reason`). */
  enabled: boolean;
  reason?: string;
  restored: boolean;
  saves: number;
  lastSavedAt: string | null;
  lastError: string | null;
}

export const newStatus = (): PersistenceStatus => ({ enabled: false, restored: false, saves: 0, lastSavedAt: null, lastError: null });

export interface BootResult {
  saved: SavedWorld | null;
  /** The store to save to afterwards, or null if saving must stay off. */
  store: StoreLike | null;
  reason?: string;
}

/**
 * Open the store and read the saved world, retrying while the database is not ready.
 * - Only a save that is unreadable (`SaveError`) means "start fresh"; the store has already put it aside.
 * - Any other failure (a dropped connection, a timeout) is retried, and if it never works saving stays OFF: starting
 *   fresh and saving later could overwrite the real world with an empty one.
 */
export async function loadForBoot(
  open: () => Promise<StoreLike>, log: LoggerLike, opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<BootResult> {
  const attempts = opts.attempts ?? 10, delayMs = opts.delayMs ?? 2000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const store = await open();
      try {
        return { saved: await store.load(), store };
      } catch (err) {
        if (err instanceof SaveError) { log.error(err.message); return { saved: null, store }; } // unreadable and already set aside: start fresh
        throw err; // anything else is a problem with the database, not with the save
      }
    } catch (err) {
      lastErr = err;
      log.warn(`database not ready (attempt ${attempt}/${attempts}): ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  const reason = `database unreachable at start-up: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
  log.error(`${reason}. Running WITHOUT saving; restart the server once the database is back.`);
  return { saved: null, store: null, reason };
}

/** Saves the world, one save at a time, always from the latest state, and only if the result could be read back. */
export class Persistence {
  readonly status: PersistenceStatus = newStatus();
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private store: StoreLike | null, private readonly log: LoggerLike, private readonly snapshot: () => SavedWorld = serializeWorld) {
    this.status.enabled = store !== null;
  }

  /** Turn saving off for good, saying why (for example a save this office cannot be restored from must not be overwritten). */
  disable(reason: string): void {
    this.store = null;
    this.status.enabled = false;
    this.status.reason = reason;
  }

  /** True while a save is queued or running. */
  get busy(): boolean { return this.pending > 0; }

  /**
   * Save the world as it is *now*. If a save is already running, this one waits for it and then saves again, so a caller
   * (shutdown, an admin change) can rely on the state at the moment of the call being in the database when this resolves.
   */
  saveNow(): Promise<void> {
    if (!this.store) return Promise.resolve();
    this.pending++;
    this.chain = this.chain.then(() => this.write()).finally(() => { this.pending--; });
    return this.chain;
  }

  private async write(): Promise<void> {
    const store = this.store;
    if (!store) return;
    try {
      const world = this.snapshot();
      // what goes into the database is JSON: make sure that, read back, it is still a world (NaN would become null)
      parseSavedWorld(JSON.parse(JSON.stringify(world)));
      await store.save(world);
      this.status.saves++;
      this.status.lastSavedAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.status.lastError !== msg) this.log.error(`saving the world failed: ${msg}`);
      this.status.lastError = msg;
    }
  }
}
