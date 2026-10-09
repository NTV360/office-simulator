import {
  DEFAULTS, clampSlotCount, initDay, initState, interactables, loadLayout, officeLayout, people, isStaff, resetSim, setSeed, sim, stepSim,
} from '@office/shared';

// The world the server runs: the shared simulation, stepped at a fixed rate. The simulation keeps its state in
// module-level singletons (see docs/PHASE-1-BREAKDOWN.md), so there is exactly one World per process.

export interface WorldOptions {
  /** Simulation steps (and snapshots) per second. */
  tickRate: number;
  /** How many staff the office starts with. Never more than there are desks. */
  slotCount: number;
  /** Clock speed: 1 is a normal day; the client offers 1, 3 and 8. */
  speed: number;
  paused: boolean;
  /** Fixes the randomness so a run repeats (tests). Unset in normal use. */
  seed?: number;
}

export const SPEED_RANGE: [number, number] = [0.25, 8];
export const TICK_RATE_RANGE: [number, number] = [1, 60];

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

/** Read the world settings from environment variables (TICK_RATE, SLOT_COUNT, SIM_SPEED, SIM_PAUSED, WORLD_SEED). */
export function readWorldOptions(env: Record<string, string | undefined>): WorldOptions {
  const seed = env.WORLD_SEED !== undefined && env.WORLD_SEED.trim() !== '' ? num(env.WORLD_SEED, NaN) : NaN;
  return {
    tickRate: clamp(Math.round(num(env.TICK_RATE, DEFAULTS.tickRate)), TICK_RATE_RANGE),
    slotCount: num(env.SLOT_COUNT, DEFAULTS.slotCount),
    speed: clamp(num(env.SIM_SPEED, 1), SPEED_RANGE),
    paused: env.SIM_PAUSED === 'true' || env.SIM_PAUSED === '1',
    seed: Number.isFinite(seed) ? seed : undefined,
  };
}

export interface TickStats {
  /** How long the most recent tick took, in milliseconds. */
  lastMs: number;
  /** Average over the last 100 ticks. */
  avgMs: number;
  /** Slowest of the last 100 ticks. */
  maxMs: number;
  /** Ticks that started more than one interval late. */
  lateTicks: number;
}

export interface WorldStatus {
  tick: number;
  tickRate: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  staff: number;
  present: number;
  slots: number;
  desks: number;
  tickMs: TickStats;
}

const WINDOW = 100;
const MAX_CATCH_UP = 3;

export class World {
  tick = 0;
  readonly options: WorldOptions;
  private readonly durations: number[] = [];
  private lateTicks = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  private readonly now: () => number;
  private readonly listeners: Array<(tick: number) => void> = [];

  constructor(options: WorldOptions, now: () => number = () => performance.now()) {
    this.options = { ...options };
    this.now = now;
  }

  /** Call `fn` after every tick (the broadcaster sends the snapshot from here). A failing listener is logged, never fatal. */
  onTick(fn: (tick: number) => void): void { this.listeners.push(fn); }

  /** Build the office from the layout data and start a live mid-morning. */
  init(): void {
    resetSim();
    loadLayout(officeLayout);
    setSeed(this.options.seed ?? null);
    initState();
    const slots = clampSlotCount(this.options.slotCount, interactables.of('desk').length);
    initDay(slots);
    sim.speed = this.options.speed;
    sim.paused = this.options.paused;
    this.tick = 0;
    this.durations.length = 0;
    this.lateTicks = 0;
  }

  /** One fixed step of the simulation (nothing moves while paused, but the tick still counts). */
  step(): void {
    const t0 = this.now();
    if (!sim.paused) stepSim(1 / this.options.tickRate);
    this.tick++;
    for (const fn of this.listeners) {
      try { fn(this.tick); } catch (err) { console.error('tick listener failed:', err); }
    }
    this.durations.push(this.now() - t0); // includes building and sending the snapshot
    if (this.durations.length > WINDOW) this.durations.shift();
  }

  /** Run the loop until `stop()`. Drift-corrected: each tick is scheduled against the clock, not against the last tick. */
  start(): void {
    if (this.timer) return;
    const interval = 1000 / this.options.tickRate;
    this.nextAt = this.now() + interval;
    const loop = () => {
      const now = this.now();
      let ran = 0;
      while (now >= this.nextAt && ran < MAX_CATCH_UP) {
        if (now - this.nextAt > interval) this.lateTicks++;
        this.step();
        this.nextAt += interval;
        ran++;
      }
      if (now >= this.nextAt) this.nextAt = now + interval; // far behind: skip ahead instead of spiralling
      this.timer = setTimeout(loop, Math.max(0, this.nextAt - this.now()));
    };
    this.timer = setTimeout(loop, interval);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get running(): boolean { return this.timer !== null; }

  status(): WorldStatus {
    const d = this.durations;
    const staff = people.filter(isStaff);
    return {
      tick: this.tick,
      tickRate: this.options.tickRate,
      simTime: Math.round(sim.t * 1000) / 1000,
      day: sim.day,
      speed: sim.speed,
      paused: sim.paused,
      staff: staff.length,
      present: staff.filter(p => p.state !== 'away').length,
      slots: staff.length,
      desks: interactables.of('desk').length,
      tickMs: {
        lastMs: d.length ? d[d.length - 1] : 0,
        avgMs: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
        maxMs: d.length ? Math.max(...d) : 0,
        lateTicks: this.lateTicks,
      },
    };
  }
}
