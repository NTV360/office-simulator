import type { CharacterSpec } from '../character/spec';
import { Vec3 } from '../vec3';
import { SCREEN_VARIANTS, type ScreenKind } from './data';
import { simEvents } from './events';
import { interactables } from './interactables';
import { live, liveDay, type ClockMode } from './live';
import { hasSlot } from './person';
import { newProps } from './props';
import type { Shift } from './schedule';
import { counters, deskPool, meetings, people, resetSim, sim } from './state';
import { addObject, consumeObject, isAtHome, objects, resetAllObjects, setObjectPose, staticObjectCount, type Quat } from '../world/objects';
import { typeOf } from '../world/catalogue';
import { defaultCharacterMechanics } from './character-state';
import { createInventory, type InventoryItem, type InventoryState } from './inventory';
import type { Person } from './types';

// Saving and restoring the world. Only what cannot be recomputed is kept: who is in the office, where they sit and
// stand, their day, and the clock. A running task holds functions, so it is not saved: people who were in the building
// resume as idle where they stood and choose what to do next. Meetings end. Props in hand are dropped.
// The random stream is not saved either; a restored world continues with fresh randomness.

export const SAVE_VERSION = 6;
/** Saves written by earlier versions that can still be read (version 1 has no owners, versions 1 and 2 no moved objects, versions 1 to 3 no employee details and no clock mode, versions 1 to 4 no object heights or tilts, version 5 no runtime object definitions). */
const READABLE_VERSIONS = [1, 2, 3, 4, 5, SAVE_VERSION];

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
  /** The employee this person is (their id in the staff list), or null for made-up staff. */
  userId: string | null;
  title: string;
  department: string | null;
  shift: Shift | null;
  shiftStart: number;
  absent: boolean;
  /** Out of the building on the toilet run until this time. */
  toiletUntil: number | null;
  /** Inventory carried by this person, including persistent hotbar assignments. */
  inventory?: InventoryState;
}

/** A world object that is not where it started. (Only these are saved: everything else is at home, which the layout data says.) */
export interface SavedObject {
  id: string; x: number; z: number; rot: number;
  /** Height and whole orientation (null: upright). Absent in saves before version 5: the height it started at, upright. */
  y?: number; q?: Quat | null;
  /** Whether this append-only object was consumed into inventory. Absent in older saves means active. */
  removed?: boolean;
  /** Definition for an object appended after the static layout (save version 6+). */
  type?: string;
  variant?: number;
  station?: string | null;
  spot?: string | null;
  spots?: string[];
  dims?: number[];
}

export interface SavedWorld {
  version: typeof SAVE_VERSION;
  clock: { t: number; day: number; speed: number; paused: boolean; lastMinute: number; mode: ClockMode };
  /** How many staff have ever been created (the next name comes from this). */
  nameIdx: number;
  /** The order desks are handed out to new staff, as spot ids. */
  deskOrder: string[];
  people: SavedPerson[];
  /** The objects that are not at home. */
  objects: SavedObject[];
}

export function serializeWorld(): SavedWorld {
  return {
    version: SAVE_VERSION,
    clock: { t: sim.t, day: sim.day, speed: sim.speed, paused: sim.paused, lastMinute: sim.lastMinute, mode: live.mode },
    nameIdx: counters.nameIdx,
    deskOrder: deskPool.map(s => s.id),
    // everyone with a desk, including an owner who is online right now: after a restart nobody is online, so they are saved as autopilot
    people: people.filter(hasSlot).map(p => ({
      id: p.id, name: p.name, role: p.role, spec: p.spec, slot: p.slot ? p.slot.id : '',
      x: p.pos.x, z: p.pos.z, face: p.face, speed: p.speed, walkPhase: p.walkPhase,
      present: p.state !== 'away', arriveAt: p.arriveAt, leaveAt: p.leaveAt, lunchAt: p.lunchAt, hadLunch: p.hadLunch,
      arrivedAt: p.arrivedAt, coffees: p.coffees, screenKind: p.screenKind, screenVariant: p.screenVariant, owner: p.owner ?? null,
      userId: p.userId ?? null, title: p.title ?? p.role, department: p.department ?? null, shift: p.shift ?? null, shiftStart: p.shiftStart ?? 9 * 60,
      absent: !!p.absent, toiletUntil: p.toiletUntil ?? null,
      inventory: { items: p.inventory.items.map(item => ({ ...item })), hotbar: [...p.inventory.hotbar] },
    })),
    objects: objects.all().filter(o => o.index >= staticObjectCount() || o.removed || !isAtHome(o)).map(o => ({
      id: o.id, x: o.x, z: o.z, rot: o.rot, y: o.y, q: o.q ? [...o.q] as Quat : null,
      ...(o.index >= staticObjectCount() ? {
        type: o.type, variant: o.variant, station: o.station, spot: o.spot,
        ...(o.spots?.length ? { spots: [...o.spots] } : {}), ...(o.dims?.length ? { dims: [...o.dims] } : {}),
      } : {}),
      ...(o.removed ? { removed: true } : {}),
    })), // (one being carried is saved where it was picked up)
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

function parseShift(v: unknown, w: string): Shift | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw new SaveError(`${w} is not an object`);
  return { code: str(v.code, w + '.code', 20), start: num(v.start, w + '.start', 0, 24 * 60), end: num(v.end, w + '.end', 0, 24 * 60) };
}

function parseInventory(v: unknown, w: string): InventoryState {
  if (v === undefined) return createInventory();
  if (!isObj(v) || !Array.isArray(v.items) || !Array.isArray(v.hotbar)) throw new SaveError(`${w} is not a valid inventory`);
  if (v.items.length > 20 || v.hotbar.length !== 3) throw new SaveError(`${w} has an invalid size`);
  const items: InventoryItem[] = v.items.map((raw: unknown, i: number) => {
    if (!isObj(raw)) throw new SaveError(`${w}.items[${i}] is not an object`);
    return {
      id: str(raw.id, `${w}.items[${i}].id`, 80), type: str(raw.type, `${w}.items[${i}].type`, 80),
      x: whole(num(raw.x, `${w}.items[${i}].x`, 0, 3), `${w}.items[${i}].x`),
      y: whole(num(raw.y, `${w}.items[${i}].y`, 0, 4), `${w}.items[${i}].y`),
      rotation: whole(num(raw.rotation, `${w}.items[${i}].rotation`, 0, 90), `${w}.items[${i}].rotation`) as 0 | 90,
    };
  });
  const hotbar = v.hotbar.map((id: unknown, i: number) => id === null ? null : str(id, `${w}.hotbar[${i}]`, 80));
  try { return createInventory(items, hotbar); } catch (e) { throw new SaveError(`${w} is invalid: ${e instanceof Error ? e.message : 'invalid inventory'}`); }
}

/** Check a value read from storage and return it typed, or throw `SaveError` saying what is wrong. */
export function parseSavedWorld(raw: unknown): SavedWorld {
  if (!isObj(raw)) throw new SaveError('the save is not an object');
  if (typeof raw.version !== 'number' || !READABLE_VERSIONS.includes(raw.version)) throw new SaveError(`the save is version ${String(raw.version)}, this server reads versions ${READABLE_VERSIONS.join(' and ')}`);
  const c = raw.clock;
  if (!isObj(c)) throw new SaveError('clock is missing');
  if (c.mode !== undefined && c.mode !== 'sim' && c.mode !== 'live') throw new SaveError('clock.mode is not valid');
  const clock = { t: num(c.t, 'clock.t', 0, 30 * 60), day: num(c.day, 'clock.day', 1, 1e9), speed: num(c.speed, 'clock.speed', 0.01, 100), paused: bool(c.paused, 'clock.paused'), lastMinute: num(c.lastMinute, 'clock.lastMinute'), mode: (c.mode ?? 'sim') as ClockMode };
  if (!Array.isArray(raw.deskOrder) || raw.deskOrder.length > 5000) throw new SaveError('deskOrder is not a list');
  const deskOrder = raw.deskOrder.map((d, i) => str(d, `deskOrder[${i}]`));
  if (!Array.isArray(raw.people) || raw.people.length > 5000) throw new SaveError('people is not a list');
  const seen = new Set<number>(), desks = new Set<string>();
  const list = raw.people.map((p: unknown, i: number): SavedPerson => {
    if (!isObj(p)) throw new SaveError(`people[${i}] is not an object`);
    const w = `people[${i}]`;
    const id = whole(num(p.id, w + '.id', 0, 65534), w + '.id');
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
      userId: p.userId === undefined || p.userId === null ? null : str(p.userId, w + '.userId', 64),
      title: p.title === undefined ? str(p.role, w + '.role', 60) : str(p.title, w + '.title', 80),
      department: p.department === undefined || p.department === null ? null : str(p.department, w + '.department', 80),
      shift: parseShift(p.shift, w + '.shift'),
      shiftStart: p.shiftStart === undefined ? 9 * 60 : num(p.shiftStart, w + '.shiftStart', 0, 48 * 60),
      absent: p.absent === undefined ? false : bool(p.absent, w + '.absent'),
      toiletUntil: p.toiletUntil === undefined || p.toiletUntil === null ? null : num(p.toiletUntil, w + '.toiletUntil'),
      inventory: parseInventory(p.inventory, w + '.inventory'),
    };
  });
  const rawObjects = raw.objects === undefined ? [] : raw.objects; // (saves from before objects had none)
  if (!Array.isArray(rawObjects) || rawObjects.length > 5000) throw new SaveError('objects is not a list');
  const seenObjects = new Set<string>();
  const moved = rawObjects.map((o: unknown, i: number): SavedObject => {
    if (!isObj(o)) throw new SaveError(`objects[${i}] is not an object`);
    const w = `objects[${i}]`;
    const id = str(o.id, w + '.id', 40);
    if (!/^obj:[0-9]{1,5}$/.test(id)) throw new SaveError(`${w}.id is not an object id`);
    if (seenObjects.has(id)) throw new SaveError(`${w} repeats ${id}`);
    seenObjects.add(id);
    const saved: SavedObject = { id, x: num(o.x, w + '.x', -500, 500), z: num(o.z, w + '.z', -500, 500), rot: num(o.rot, w + '.rot', -1000, 1000) };
    if (o.y !== undefined) saved.y = num(o.y, w + '.y', -50, 50);
    if (o.q !== undefined && o.q !== null) {
      if (!Array.isArray(o.q) || o.q.length !== 4) throw new SaveError(w + '.q is not an orientation');
      saved.q = o.q.map((v: unknown, k: number) => num(v, w + '.q[' + k + ']', -1.001, 1.001)) as Quat;
    }
    if (o.removed !== undefined) saved.removed = bool(o.removed, w + '.removed');
    const hasDefinition = o.type !== undefined || o.variant !== undefined || o.station !== undefined || o.spot !== undefined || o.spots !== undefined || o.dims !== undefined;
    if (hasDefinition) {
      if (o.type === undefined || o.variant === undefined || o.station === undefined || o.spot === undefined) {
        throw new SaveError(`${w} has an incomplete runtime definition`);
      }
      const type = str(o.type, w + '.type', 80);
      if (!typeOf(type)) throw new SaveError(`${w}.type is unknown`);
      saved.type = type;
      saved.variant = whole(num(o.variant, w + '.variant', 0, 1000), w + '.variant');
      const parseRef = (v: unknown, what: string): string | null => v === null ? null : str(v, what, 100);
      saved.station = parseRef(o.station, w + '.station');
      saved.spot = parseRef(o.spot, w + '.spot');
      if (o.spots !== undefined) {
        if (!Array.isArray(o.spots) || o.spots.length > 20) throw new SaveError(`${w}.spots is not a list`);
        saved.spots = o.spots.map((v: unknown, k: number) => str(v, `${w}.spots[${k}]`, 100));
      }
      if (o.dims !== undefined) {
        if (!Array.isArray(o.dims) || o.dims.length > 8) throw new SaveError(`${w}.dims is not a list`);
        saved.dims = o.dims.map((v: unknown, k: number) => num(v, `${w}.dims[${k}]`, 0.001, 100));
      }
    }
    return saved;
  });
  return { version: SAVE_VERSION, clock, nameIdx: whole(num(raw.nameIdx, 'nameIdx', 0, 1e9), 'nameIdx'), deskOrder, people: list, objects: moved };
}

/**
 * Everything in the saved objects that could make the rebuild fail, checked before anything is changed: a runtime object must come in
 * creation order, be of a known kind, and be tied to seats this office has. (A restore that failed halfway would leave a world that is part
 * the save and part what was running.) Mirrors what `addObject` refuses.
 */
function assertObjectsRestorable(saved: SavedWorld): void {
  const spots = new Set(interactables.all().map(s => s.id));
  let count = objects.count();
  for (const s of saved.objects) {
    if (objects.byId(s.id) || s.type === undefined) continue;
    if (s.id !== `obj:${count}`) throw new SaveError(`runtime object ${s.id} is out of append order`);
    if (!typeOf(s.type)) throw new SaveError(`runtime object ${s.id} is invalid: unknown object type "${s.type}"`);
    for (const id of [...(s.spot ? [s.spot] : []), ...(s.spots ?? [])]) {
      if (!spots.has(id)) throw new SaveError(`runtime object ${s.id} is invalid: it carries ${id}, which does not exist`);
    }
    count++;
  }
}

/**
 * Rebuild the world from a save. The office layout must already be loaded. Starts from an empty simulation, so it
 * replaces whatever was there. Uses no random numbers. Announces every person with `personAdded`.
 */
export function restoreWorld(saved: SavedWorld): void {
  assertObjectsRestorable(saved);
  const bySpotId = new Map(interactables.of('desk').map(s => [s.id, s]));
  const wanted = saved.people.map(p => {
    if (p.slot === '') return null;
    const desk = bySpotId.get(p.slot);
    if (!desk) throw new SaveError(`${p.name} sits at ${p.slot}, which this office does not have`);
    return desk;
  });
  resetSim();
  const { mode, ...clock } = saved.clock;
  Object.assign(sim, clock);
  live.mode = mode;
  live.date = mode === 'live' ? liveDay() : null; // (otherwise the first tick of the live clock would think a new day had begun and send everybody home)
  counters.nameIdx = saved.nameIdx;
  // desk order: the saved order first (for desks that still exist), then any desk the save did not know about
  const order = saved.deskOrder.map(id => bySpotId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const listed = new Set(order);
  for (const s of interactables.of('desk')) if (!listed.has(s)) order.push(s);
  deskPool.push(...order);
  saved.people.forEach((s, i) => {
    const slot = wanted[i] ?? undefined;
    if (!slot) return; // an entry without a desk is nobody now: the helper is made again by ensureHelper, and guests are not saved
    const p: Person = {
      id: s.id, controller: 'ai', ...(s.owner !== null ? { owner: s.owner } : {}), name: s.name, role: s.role, spec: s.spec, slot,
      pos: new Vec3(s.x, 0, s.z), face: s.face, faceGoal: s.face, speed: s.speed,
      state: s.present ? 'idle' : 'away', shown: s.present, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [],
      walkPhase: s.walkPhase, animT: 0, pose: {}, arriveAt: s.arriveAt, leaveAt: s.leaveAt, lunchAt: s.lunchAt, hadLunch: s.hadLunch,
      arrivedAt: s.arrivedAt, coffees: s.coffees, chatWith: null, meeting: null, screenKind: s.screenKind, screenVariant: s.screenVariant,
      userId: s.userId, title: s.title, department: s.department, shift: s.shift, shiftStart: s.shiftStart, absent: s.absent, toiletUntil: s.toiletUntil,
      mechanics: defaultCharacterMechanics(), inventory: s.inventory ? createInventory(s.inventory.items, s.inventory.hotbar) : createInventory(),
    };
    if (s.toiletUntil !== null) p.props.bucket = true; // out on the toilet run: with the one bucket
    if (slot) slot.owner = p;
    people.push(p);
    simEvents.emit('personAdded', p);
  });
  // objects: everything goes home, then the saved ones go where they were. Runtime objects include their
  // definition because they are not part of the immutable layout loaded above.
  resetAllObjects();
  for (const s of saved.objects) {
    let o = objects.byId(s.id);
    if (!o && s.type !== undefined) {
      const expected = `obj:${objects.count()}`;
      if (s.id !== expected) throw new SaveError(`runtime object ${s.id} is out of append order`);
      try {
        o = addObject({ type: s.type, variant: s.variant!, station: s.station!, spot: s.spot!, spots: s.spots, dims: s.dims, x: s.x, z: s.z, rot: s.rot, y: s.y ?? 0 });
      } catch (e) {
        throw new SaveError(`runtime object ${s.id} is invalid: ${e instanceof Error ? e.message : 'invalid definition'}`);
      }
    }
    if (!o) continue;
    setObjectPose(o, s.x, s.z, s.rot, s.y ?? o.home.y, s.q ?? null);
    if (s.removed) consumeObject(o);
  }
  meetings.length = 0;
}
