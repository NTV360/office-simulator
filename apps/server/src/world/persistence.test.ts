import { describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION, SaveError, type SavedWorld } from '@office/shared';
import { Persistence, loadForBoot, type LoggerLike, type StoreLike } from './persistence';

const quiet = (): LoggerLike & { errors: string[]; warns: string[] } => {
  const l = { errors: [] as string[], warns: [] as string[], log: () => {}, warn: (m: string) => l.warns.push(m), error: (m: string) => l.errors.push(m) };
  return l;
};
const world = (t: number): SavedWorld => ({ version: SAVE_VERSION, clock: { t, day: 1, speed: 1, paused: false, lastMinute: 0 }, nameIdx: 0, deskOrder: [], people: [] });
const noWait = { delayMs: 0, sleep: async () => {} };

describe('loadForBoot', () => {
  it('returns what the store has', async () => {
    const store: StoreLike = { load: async () => world(500), save: async () => {} };
    const r = await loadForBoot(async () => store, quiet(), noWait);
    expect(r.saved?.clock.t).toBe(500);
    expect(r.store).toBe(store);
  });

  it('retries while the database is not ready, then carries on', async () => {
    let tries = 0;
    const store: StoreLike = { load: async () => world(1), save: async () => {} };
    const log = quiet();
    const r = await loadForBoot(async () => { if (++tries < 4) throw new Error('ECONNREFUSED'); return store; }, log, noWait);
    expect(tries).toBe(4);
    expect(r.store).toBe(store);
    expect(log.warns).toHaveLength(3);
  });

  it('a dropped connection while reading is retried, never mistaken for "there is no save"', async () => {
    let reads = 0;
    const store: StoreLike = { load: async () => { if (++reads < 3) throw new Error('connection reset'); return world(777); }, save: async () => {} };
    const r = await loadForBoot(async () => store, quiet(), noWait);
    expect(r.saved?.clock.t).toBe(777);
    expect(reads).toBe(3);
  });

  it('if the database never answers, saving stays OFF so a fresh world cannot replace the real one', async () => {
    const log = quiet();
    const r = await loadForBoot(async () => { throw new Error('ECONNREFUSED'); }, log, { attempts: 3, ...noWait });
    expect(r.store).toBeNull();
    expect(r.saved).toBeNull();
    expect(r.reason).toMatch(/unreachable/);
    expect(log.errors.join()).toMatch(/WITHOUT saving/);
  });

  it('a read that keeps failing leaves saving off too (not just a failing connection)', async () => {
    const store: StoreLike = { load: async () => { throw new Error('statement timeout'); }, save: async () => {} };
    const r = await loadForBoot(async () => store, quiet(), { attempts: 2, ...noWait });
    expect(r.store).toBeNull();
  });

  it('an unreadable save means start fresh, with saving on (the store has set it aside)', async () => {
    const store: StoreLike = { load: async () => { throw new SaveError('clock is missing'); }, save: async () => {} };
    const log = quiet();
    const r = await loadForBoot(async () => store, log, noWait);
    expect(r.saved).toBeNull();
    expect(r.store).toBe(store);
    expect(log.errors.join()).toMatch(/clock is missing/);
  });
});

describe('Persistence', () => {
  it('saves one at a time, and a request made during a save is saved after it, from the newer state', async () => {
    let state = 100;
    const written: number[] = [];
    let running = 0, maxRunning = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let first = true;
    const store: StoreLike = {
      load: async () => null,
      save: async w => {
        running++; maxRunning = Math.max(maxRunning, running);
        if (first) { first = false; await gate; }
        written.push(w.clock.t);
        running--;
      },
    };
    const p = new Persistence(store, quiet(), () => world(state));
    const a = p.saveNow();
    await Promise.resolve(); await Promise.resolve(); // the first save is now running, held up
    state = 200;                                       // the world moves on while it is
    const b = p.saveNow();
    expect(p.busy).toBe(true);
    release();
    await Promise.all([a, b]);
    expect(maxRunning).toBe(1);                        // never two at once
    expect(written).toEqual([100, 200]);               // the request made during a save is saved afterwards, from the newer state
    expect(p.busy).toBe(false);
    expect(p.status.saves).toBe(2);
  });

  it('never writes a world that would not read back (NaN becomes null in JSON)', async () => {
    const save = vi.fn(async () => {});
    const log = quiet();
    const p = new Persistence({ load: async () => null, save }, log, () => world(NaN));
    await p.saveNow();
    expect(save).not.toHaveBeenCalled();
    expect(p.status.lastError).toMatch(/clock\.t/);
    expect(log.errors).toHaveLength(1);
    await p.saveNow(); await p.saveNow();
    expect(log.errors).toHaveLength(1); // the same problem is not logged again and again
  });

  it('records a failing save, keeps trying, and clears the error when one works', async () => {
    let fail = true;
    const p = new Persistence({ load: async () => null, save: async () => { if (fail) throw new Error('disk full'); } }, quiet(), () => world(5));
    await p.saveNow();
    expect(p.status).toMatchObject({ saves: 0, lastError: 'disk full' });
    fail = false;
    await p.saveNow();
    expect(p.status).toMatchObject({ saves: 1, lastError: null });
    expect(p.status.lastSavedAt).not.toBeNull();
  });

  it('a failing save never makes saveNow throw', async () => {
    const p = new Persistence({ load: async () => null, save: async () => { throw new Error('x'); } }, quiet(), () => world(5));
    await expect(p.saveNow()).resolves.toBeUndefined();
  });

  it('without a store it does nothing, and can be switched off for good with a reason', async () => {
    const save = vi.fn(async () => {});
    const none = new Persistence(null, quiet());
    await none.saveNow();
    expect(none.status.enabled).toBe(false);
    const p = new Persistence({ load: async () => null, save }, quiet(), () => world(5));
    expect(p.status.enabled).toBe(true);
    p.disable('layout changed');
    await p.saveNow();
    expect(save).not.toHaveBeenCalled();
    expect(p.status).toMatchObject({ enabled: false, reason: 'layout changed' });
  });
});
