import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { people, hasSlot, sim, setSeed } from '@office/shared';
import { World, readWorldOptions, type WorldOptions } from './world';

const base: WorldOptions = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 1 };

afterEach(() => { vi.useRealTimers(); setSeed(null); });

describe('readWorldOptions', () => {
  it('uses the defaults when nothing is set', () => {
    expect(readWorldOptions({})).toEqual({ tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: undefined });
  });
  it('reads and clamps what is set, and ignores nonsense', () => {
    const o = readWorldOptions({ TICK_RATE: '500', SLOT_COUNT: '12', SIM_SPEED: '100', SIM_PAUSED: 'true', WORLD_SEED: '7' });
    expect(o).toEqual({ tickRate: 60, slotCount: 12, speed: 8, paused: true, seed: 7 });
    expect(readWorldOptions({ TICK_RATE: 'abc', SIM_SPEED: '-3', WORLD_SEED: 'x' })).toEqual({ tickRate: 20, slotCount: 40, speed: 0.25, paused: false, seed: undefined });
  });
});

describe('World', () => {
  it('builds the real office with the requested number of staff, never more than there are desks', () => {
    const w = new World({ ...base, slotCount: 12 }); w.init();
    expect(w.status()).toMatchObject({ staff: 12, desks: 70, tick: 0 });
    const many = new World({ ...base, slotCount: 500 }); many.init();
    expect(many.status().staff).toBe(70);
  });

  it('steps the clock at the tick rate, and not while paused', () => {
    const w = new World(base); w.init();
    const t0 = sim.t;
    for (let i = 0; i < 20; i++) w.step(); // one second of ticks
    expect(sim.t - t0).toBeCloseTo(0.4, 9); // 0.4 sim minutes per real second at 1x
    sim.paused = true;
    const t1 = sim.t;
    for (let i = 0; i < 20; i++) w.step();
    expect(sim.t).toBe(t1);
    expect(w.status().tick).toBe(40); // paused ticks still count
  });

  it('speed multiplies the clock', () => {
    const w = new World({ ...base, speed: 8 }); w.init();
    const t0 = sim.t;
    for (let i = 0; i < 20; i++) w.step();
    expect(sim.t - t0).toBeCloseTo(3.2, 9);
  });

  it('is the browser simulation: seed 1 matches the recorded clock and people at the recorded checkpoints', () => {
    const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../tests/browser/golden/seed-1.json'), 'utf8'));
    const w = new World(base); w.init();
    const r3 = (v: number) => (Math.round(v * 1000) / 1000) || 0;
    let done = 0;
    for (let i = 0; i < golden.steps.length; i++) {
      for (; done < golden.steps[i]; done++) w.step();
      const g = golden.fingerprints[i];
      expect(r3(sim.t)).toBe(g.clock.t);
      const staff = people.filter(hasSlot);
      expect(staff.map(p => [p.name, p.state, r3(p.pos.x), r3(p.pos.z)])).toEqual(g.persons.map((p: { name: string; state: string; x: number; z: number }) => [p.name, p.state, p.x, p.z]));
    }
  });

  it('the same seed gives the same world, a different seed a different one', () => {
    const run = (seed: number) => { const w = new World({ ...base, seed }); w.init(); for (let i = 0; i < 2000; i++) w.step(); return JSON.stringify(people.map(p => [p.name, p.state, p.pos.x, p.pos.z])); };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('reports tick timings', () => {
    const w = new World(base); w.init();
    for (let i = 0; i < 50; i++) w.step();
    const t = w.status().tickMs;
    expect(t.avgMs).toBeGreaterThanOrEqual(0);
    expect(t.maxMs).toBeGreaterThanOrEqual(t.avgMs);
    expect(t.maxMs).toBeLessThan(50); // a tick must fit well inside its 50 ms
  });
});

describe('the tick loop', () => {
  beforeEach(() => vi.useFakeTimers());

  it('runs at the tick rate and stops when told', () => {
    const w = new World(base, () => Date.now()); w.init();
    w.start();
    vi.advanceTimersByTime(1000);
    expect(w.status().tick).toBe(20);
    w.stop();
    vi.advanceTimersByTime(1000);
    expect(w.status().tick).toBe(20);
    expect(w.running).toBe(false);
  });

  it('catches up a little after a stall, then skips ahead rather than spiralling', () => {
    const w = new World(base, () => Date.now()); w.init();
    w.start();
    vi.advanceTimersByTime(50);
    expect(w.status().tick).toBe(1);
    vi.setSystemTime(Date.now() + 5000); // the event loop was blocked for five seconds
    vi.advanceTimersByTime(60);
    const s = w.status();
    expect(s.tick).toBeLessThanOrEqual(1 + 3 + 2); // at most a few catch-up ticks, not 100
    expect(s.tickMs.lateTicks).toBeGreaterThan(0);
    w.stop();
  });

  it('starting twice does not run two loops', () => {
    const w = new World(base, () => Date.now()); w.init();
    w.start(); w.start();
    vi.advanceTimersByTime(1000);
    expect(w.status().tick).toBe(20);
    w.stop();
  });
});

describe('the loop survives faults', () => {
  beforeEach(() => vi.useFakeTimers());

  it('a listener that throws is reported (once a second) and the world keeps ticking', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = new World(base, () => Date.now()); w.init();
    w.onTick(() => { throw new Error('boom'); });
    w.start();
    vi.advanceTimersByTime(2000);
    expect(w.status().tick).toBe(40);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3); // not 40
    w.stop(); spy.mockRestore();
  });

  it('stop() called from inside a tick really stops it', () => {
    const w = new World(base, () => Date.now()); w.init();
    w.onTick(t => { if (t === 5) w.stop(); });
    w.start();
    vi.advanceTimersByTime(2000);
    expect(w.status().tick).toBe(5);
    expect(w.running).toBe(false);
  });
});
