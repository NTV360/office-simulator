import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objects, people, hasSlot, isHelper, parseSavedWorld, roster, serializeWorld, sim, setSeed, type Employee } from '@office/shared';
import { World, readWorldOptions, type WorldOptions } from './world';
import type { ItemImpact } from '../physics/item-physics';

const base: WorldOptions = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 1 };
const employee = (userId: string, department = 'UI/UX'): Employee => ({ userId, firstName: userId, lastName: 'Employee', department, intern: false, shift: null, character: null, desk: null });
const rosterFor = (count: number): Employee[] => Array.from({ length: count }, (_, i) => employee(`world-${i + 1}`));

beforeEach(() => { roster.list = rosterFor(12); roster.status = 'ready'; });
afterEach(() => { vi.useRealTimers(); setSeed(null); roster.list = null; roster.status = 'unavailable'; });

describe('readWorldOptions', () => {
  it('uses the defaults when nothing is set', () => {
    expect(readWorldOptions({})).toEqual({ tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: undefined, physics: true });
    expect(readWorldOptions({ PHYSICS: 'off' }).physics).toBe(false);
  });
  it('reads and clamps what is set, and ignores nonsense', () => {
    const o = readWorldOptions({ TICK_RATE: '500', SLOT_COUNT: '12', SIM_SPEED: '100', SIM_PAUSED: 'true', WORLD_SEED: '7' });
    expect(o).toEqual({ tickRate: 60, slotCount: 12, speed: 8, paused: true, seed: 7, physics: true });
    expect(readWorldOptions({ TICK_RATE: '1' }).tickRate).toBe(10); // a slower world would let one step of a runner be long enough to cheat with
    expect(readWorldOptions({ SLOT_COUNT: '7.9' }).slotCount).toBe(7);
    expect(readWorldOptions({ SLOT_COUNT: '-3' }).slotCount).toBe(0);
    expect(readWorldOptions({ SLOT_COUNT: 'abc', SIM_SPEED: '-3', WORLD_SEED: 'x' })).toEqual({ tickRate: 20, slotCount: 40, speed: 0.25, paused: false, seed: undefined, physics: true });
  });
});

describe('World', () => {
  it('builds every authoritative roster employee, bounded by compatible desks', () => {
    const w = new World({ ...base, slotCount: 5 }); w.init();
    expect(w.status()).toMatchObject({ staff: 12, desks: 80, tick: 0 });
    expect(people.filter(hasSlot).every(p => roster.list!.some(e => e.userId === p.userId))).toBe(true);
    roster.list = [...rosterFor(74), ...Array.from({ length: 6 }, (_, i) => employee(`hr-${i + 1}`, 'Human Resources'))];
    const many = new World({ ...base, slotCount: 500 }); many.init();
    expect(many.status().staff).toBe(80);
    expect(people.filter(hasSlot).every(p => roster.list!.some(e => e.userId === p.userId))).toBe(true);
  });

  it('has the office helper, and has her again after a restart from a save (she is not saved)', () => {
    const w = new World({ ...base, slotCount: 12 }); w.init();
    expect(people.filter(isHelper)).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    expect(saved.people.some((p: { name: string }) => p.name === 'Office Helper')).toBe(false);
    const again = new World({ ...base, slotCount: 12 }); again.init(parseSavedWorld(saved));
    expect(people.filter(isHelper)).toHaveLength(1);
    expect(people.filter(hasSlot)).toHaveLength(12);
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

  it('is the browser simulation: seed 1 matches the recorded clock and people at the recorded checkpoints', { timeout: 30000 }, () => {
    const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../tests/browser/golden/seed-1.json'), 'utf8'));
    const w = new World(base); w.init();
    const r3 = (v: number) => (Math.round(v * 1000) / 1000) || 0;
    let done = 0;
    for (let i = 0; i < golden.steps.length; i++) {
      for (; done < golden.steps[i]; done++) w.step();
      const g = golden.fingerprints[i];
      expect(r3(sim.t)).toBe(g.clock.t);
      const staff = people.filter(hasSlot);
      expect(staff).toHaveLength(roster.list!.length);
      expect(staff.every(p => roster.list!.some(e => e.userId === p.userId))).toBe(true);
    }
  });

  it('the same seed gives the same world, a different seed a different one', () => {
    const run = (seed: number) => { const w = new World({ ...base, seed }); w.init(); for (let i = 0; i < 2000; i++) w.step(); return JSON.stringify(people.map(p => [p.name, p.state, p.pos.x, p.pos.z])); };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('reports the median and the 99th percentile of the recent ticks, in order, and zero before any tick', () => {
    const w = new World(base); w.init();
    expect(w.status().tickMs).toMatchObject({ p50Ms: 0, p99Ms: 0 });
    for (let i = 0; i < 300; i++) w.step();
    const t = w.status().tickMs;
    expect(t.p50Ms).toBeGreaterThan(0);
    expect(t.p99Ms).toBeGreaterThanOrEqual(t.p50Ms);
    expect(t.maxMs).toBeGreaterThanOrEqual(t.avgMs);
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

describe('item-impact routing', () => {
  it('rejects stale or malformed impacts and isolates listener failures', () => {
    const w = new World(base); w.init();
    const person = people[0];
    const object = objects.all().find(o => !o.removed)!;
    const seen: ItemImpact[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    w.onItemImpact(() => { throw new Error('listener failure'); });
    w.onItemImpact(impact => seen.push(impact));
    const valid = { object, personId: person.id, normal: { x: 1, z: 0 }, relativeSpeed: 4 } satisfies ItemImpact;
    (w as unknown as { dispatchItemImpact: (impact: ItemImpact) => void }).dispatchItemImpact(valid);
    (w as unknown as { dispatchItemImpact: (impact: ItemImpact) => void }).dispatchItemImpact({ ...valid, normal: { x: NaN, z: 0 } });
    (w as unknown as { dispatchItemImpact: (impact: ItemImpact) => void }).dispatchItemImpact({ ...valid, personId: 999999 });
    object.removed = true;
    (w as unknown as { dispatchItemImpact: (impact: ItemImpact) => void }).dispatchItemImpact(valid);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(valid);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
