import type { CharacterSpec } from '../character/spec';
import { Vec3 } from '../vec3';
import { SCREEN_VARIANTS, type ScreenKind } from './data';
import { simEvents } from './events';
import { interactables } from './interactables';
import { hasSlot } from './person';
import { newProps } from './props';
import { counters, deskPool, meetings, people, resetSim, sim } from './state';
import type { Person } from './types';

// Saving and restoring the world. Only what cannot be recomputed is kept: who is in the office, where they sit and
// stand, their day, and the clock. A running task holds functions, so it is not saved: people who were in the building
// resume as idle where they stood and choose what to do next. Meetings end. Props in hand are dropped.
// The random stream is not saved either; a restored world continues with fresh randomness.

export const SAVE_VERSION = 2;
/** Saves written by earlier versions that can still be read (they simply have no owners). */
const READABLE_VERSIONS = [1, SAVE_VERSION];

export interface SavedPerson {
  id: number;
  name: string;
  role: string;
  spec: CharacterSpec;
  /** Id of the desk they own (`desk:12`). */
  slot: string;
  x: number;
  z: number;
  face: number;
  speed: number;
  walkPhase: number;
  /** In the building (they resume idle) or not (they stay away until their arrival time). */
  present: boolean;
  arriveAt: number;
  leaveAt: number;
  lunchAt: number;
  hadLunch: boolean;
  arrivedAt: number | null;
  coffees: number;
  screenKind: ScreenKind;
  screenVariant: number;
  /** The account that owns this desk and person, or null for a plain NPC. */
  owner: number | null;
}

export interface SavedWorld {
  version: typeof SAVE_VERSION;
  clock: { t: number; day: number; speed: number; paused: boolean; lastMinute: number };
  /** How many staff have ever been created (the next name comes from this). */
  nameIdx: number;
  /** The order desks are handed out to new staff, as spot ids. */
  deskOrder: string[];
  people: SavedPerson[];
}

export function serializeWorld(): SavedWorld {
  return {
    version: SAVE_VERSION,
    clock: { t: sim.t, day: sim.day, speed: sim.speed, paused: sim.paused, lastMinute: sim.lastMinute },
    nameIdx: counters.nameIdx,
    deskOrder: deskPool.map(s => s.id),
    // everyone with a desk, including an owner who is online right now: after a restart nobody is online, so they are saved as autopilot
    people: people.filter(hasSlot).map(p => ({
      id: p.id, name: p.name, role: p.role, spec: p.spec, slot: p.slot ? p.slot.id : '',
      x: p.pos.x, z: p.pos.z, face: p.face, speed: p.speed, walkPhase: p.walkPhase,
      present: p.state !== 'away', arriveAt: p.arriveAt, leaveAt: p.leaveAt, lunchAt: p.lunchAt, hadLunch: p.hadLunch,
      arrivedAt: p.arrivedAt, coffees: p.coffees, screenKind: p.screenKind, screenVariant: p.screenVariant, owner: p.owner ?? null,
    })),
  };
}

// ---- reading what comes back from storage: never trust it

export class SaveError extends Error {
  constructor(message: string) { super(message); this.name = 'SaveError'; }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string, lo = -Infinity, hi = Infinity): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new SaveError(`${what} is not a valid number`);
  return v;
};
const str = (v: unknown, what: string, max = 200): string => {
  if (typeof v !== 'string' || v.length > max) throw new SaveError(`${what} is not valid text`);
  return v;
};
const whole = (v: number, what: string): number => {
  if (!Number.isInteger(v)) throw new SaveError(`${what} is not a whole number`);
  return v;
};
const bool = (v: unknown, what: string): boolean => {
  if (typeof v !== 'boolean') throw new SaveError(`${what} is not true or false`);
  return v;
};

/** Check a value read from storage and return it typed, or throw `SaveError` saying what is wrong. */
export function parseSavedWorld(raw: unknown): SavedWorld {
  if (!isObj(raw)) throw new SaveError('the save is not an object');
  if (typeof raw.version !== 'number' || !READABLE_VERSIONS.includes(raw.version)) throw new SaveError(`the save is version ${String(raw.version)}, this server reads versions ${READABLE_VERSIONS.join(' and ')}`);
  const c = raw.clock;
  if (!isObj(c)) throw new SaveError('clock is missing');
  const clock = { t: num(c.t, 'clock.t', 0, 24 * 60), day: num(c.day, 'clock.day', 1, 1e9), speed: num(c.speed, 'clock.speed', 0.01, 100), paused: bool(c.paused, 'clock.paused'), lastMinute: num(c.lastMinute, 'clock.lastMinute') };
  if (!Array.isArray(raw.deskOrder) || raw.deskOrder.length > 5000) throw new SaveError('deskOrder is not a list');
  const deskOrder = raw.deskOrder.map((d, i) => str(d, `deskOrder[${i}]`));
  if (!Array.isArray(raw.people) || raw.people.length > 5000) throw new SaveError('people is not a list');
  const seen = new Set<number>(), desks = new Set<string>();
  const list = raw.people.map((p: unknown, i: number): SavedPerson => {
    if (!isObj(p)) throw new SaveError(`people[${i}] is not an object`);
    const w = `people[${i}]`;
    const id = num(p.id, w + '.id', 0, 65534);
    if (seen.has(id)) throw new SaveError(`${w} repeats id ${id}`);
    seen.add(id);
    const slot = str(p.slot, w + '.slot', 40);
    if (slot !== '') { if (desks.has(slot)) throw new SaveError(`${w} shares desk ${slot}`); desks.add(slot); }
    const screenKind = p.screenKind;
    if (screenKind !== 'code' && screenKind !== 'design' && screenKind !== 'dash') throw new SaveError(`${w}.screenKind is not valid`);
    if (!isObj(p.spec)) throw new SaveError(`${w}.spec is not an object`);
    return {
      id, name: str(p.name, w + '.name', 60), role: str(p.role, w + '.role', 60), spec: p.spec as unknown as CharacterSpec, slot,
      x: num(p.x, w + '.x', -500, 500), z: num(p.z, w + '.z', -500, 500), face: num(p.face, w + '.face'), speed: num(p.speed, w + '.speed', 0.1, 10), walkPhase: num(p.walkPhase, w + '.walkPhase'),
      present: bool(p.present, w + '.present'), arriveAt: num(p.arriveAt, w + '.arriveAt'), leaveAt: num(p.leaveAt, w + '.leaveAt'), lunchAt: num(p.lunchAt, w + '.lunchAt'),
      hadLunch: bool(p.hadLunch, w + '.hadLunch'), arrivedAt: p.arrivedAt === null ? null : num(p.arrivedAt, w + '.arrivedAt'), coffees: num(p.coffees, w + '.coffees', 0, 1e6),
      screenKind, screenVariant: num(p.screenVariant, w + '.screenVariant', 0, SCREEN_VARIANTS[screenKind] - 1),
      owner: p.owner === undefined || p.owner === null ? null : whole(num(p.owner, w + '.owner', 1, 2 ** 31 - 1), w + '.owner'),
    };
  });
  return { version: SAVE_VERSION, clock, nameIdx: num(raw.nameIdx, 'nameIdx', 0, 1e9), deskOrder, people: list };
}

/**
 * Rebuild the world from a save. The office layout must already be loaded. Starts from an empty simulation, so it
 * replaces whatever was there. Uses no random numbers. Announces every person with `personAdded`.
 */
export function restoreWorld(saved: SavedWorld): void {
  const bySpotId = new Map(interactables.of('desk').map(s => [s.id, s]));
  const wanted = saved.people.map(p => {
    if (p.slot === '') return null;
    const desk = bySpotId.get(p.slot);
    if (!desk) throw new SaveError(`${p.name} sits at ${p.slot}, which this office does not have`);
    return desk;
  });
  resetSim();
  Object.assign(sim, saved.clock);
  counters.nameIdx = saved.nameIdx;
  // desk order: the saved order first (for desks that still exist), then any desk the save did not know about
  const order = saved.deskOrder.map(id => bySpotId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const listed = new Set(order);
  for (const s of interactables.of('desk')) if (!listed.has(s)) order.push(s);
  deskPool.push(...order);
  saved.people.forEach((s, i) => {
    const slot = wanted[i] ?? undefined;
    const p: Person = {
      id: s.id, controller: 'ai', ...(s.owner !== null ? { owner: s.owner } : {}), name: s.name, role: s.role, spec: s.spec, slot,
      pos: new Vec3(s.x, 0, s.z), face: s.face, faceGoal: s.face, speed: s.speed,
      state: s.present ? 'idle' : 'away', shown: s.present, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [],
      walkPhase: s.walkPhase, animT: 0, pose: {}, arriveAt: s.arriveAt, leaveAt: s.leaveAt, lunchAt: s.lunchAt, hadLunch: s.hadLunch,
      arrivedAt: s.arrivedAt, coffees: s.coffees, chatWith: null, meeting: null, screenKind: s.screenKind, screenVariant: s.screenVariant,
    };
    if (slot) slot.owner = p;
    people.push(p);
    simEvents.emit('personAdded', p);
  });
  meetings.length = 0;
}
