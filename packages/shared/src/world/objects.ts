import { simEvents } from '../sim/events';
import { interactables, type Spot } from '../sim/interactables';
import { CATALOGUE } from './catalogue';

// World objects: the chairs and small things that can be moved, as plain data both the page and the server hold. A chair carries its
// seat: when the chair moves, the seat (and where people stand to use it, and the way it faces) moves with it, and spot ids never change.
// The starting poses are made once from the furniture code (see layout/layout.ts) and are every object's "home".

export interface Pose { x: number; z: number; rot: number }

/** What the layout data holds for one object: where it starts. */
export interface ObjectRecord {
  type: string;
  x: number;
  z: number;
  /** Radians, the way it faces (the same convention as a seat's `face`). */
  rot: number;
  /** Height of what it rests on (0 for the floor). */
  y: number;
  /** Which colour or version of its kind (an index; the page decides what each means). */
  variant: number;
  /** The desk this object belongs to (a spot id such as 'desk:12'), or null in a shared area. */
  station: string | null;
  /** The seat this object carries (a spot id), or null. */
  spot: string | null;
}

export interface WorldObject extends ObjectRecord {
  /** 'obj:' and its place in the creation order. Stable: the layout data is in this order. */
  id: string;
  index: number;
  home: Pose;
  /** The person carrying it right now, or null. */
  carriedBy: number | null;
  /** Where its seat is, relative to it (in its own frame), so the seat can follow it. */
  link: { spot: Spot; px: number; pz: number; ax: number; az: number; dface: number } | null;
}

const list: WorldObject[] = [];
const byId = new Map<string, WorldObject>();

// frame(px, py, face) in the page turns local (lx, lz) into world (lx cos f + lz sin f, -lx sin f + lz cos f)
const toWorld = (f: number, lx: number, lz: number) => ({ x: lx * Math.cos(f) + lz * Math.sin(f), z: -lx * Math.sin(f) + lz * Math.cos(f) });
const toLocal = (f: number, dx: number, dz: number) => ({ x: dx * Math.cos(f) - dz * Math.sin(f), z: dx * Math.sin(f) + dz * Math.cos(f) });

export const objects = {
  all: (): readonly WorldObject[] => list,
  count: (): number => list.length,
  byId: (id: string): WorldObject | undefined => byId.get(id),
  at: (index: number): WorldObject | undefined => list[index],
  /** Forget every object (a new layout is being loaded, or a test starts over). */
  clear(): void { list.length = 0; byId.clear(); },
};

/** Make an object at its starting pose, and tie it to the seat it carries (the seat must exist already). */
export function addObject(rec: ObjectRecord): WorldObject {
  if (!CATALOGUE[rec.type]) throw new Error(`unknown object type "${rec.type}"`);
  const o: WorldObject = { ...rec, id: `obj:${list.length}`, index: list.length, home: { x: rec.x, z: rec.z, rot: rec.rot }, carriedBy: null, link: null };
  if (rec.spot) {
    const spot = interactables.all().find(s => s.id === rec.spot);
    if (!spot) throw new Error(`object ${o.id} carries ${rec.spot}, which does not exist`);
    const p = toLocal(o.rot, spot.pos.x - o.x, spot.pos.z - o.z), a = toLocal(o.rot, spot.approach.x - o.x, spot.approach.z - o.z);
    o.link = { spot, px: p.x, pz: p.z, ax: a.x, az: a.z, dface: spot.face - o.rot };
    spot.object = o.id;
  }
  list.push(o);
  byId.set(o.id, o);
  return o;
}

/** Put an object at a pose. Its seat goes with it. Announces `objectMoved` so viewers can redraw it. */
export function setObjectPose(o: WorldObject, x: number, z: number, rot: number): void {
  o.x = x; o.z = z; o.rot = rot;
  if (o.link) {
    const { spot, px, pz, ax, az, dface } = o.link;
    const p = toWorld(rot, px, pz), a = toWorld(rot, ax, az);
    spot.pos.x = x + p.x; spot.pos.z = z + p.z;
    spot.approach.x = x + a.x; spot.approach.z = z + a.z;
    spot.face = rot + dface;
  }
  simEvents.emit('objectMoved', o);
}

export const isAtHome = (o: WorldObject): boolean => o.x === o.home.x && o.z === o.home.z && o.rot === o.home.rot && o.carriedBy === null;

/** Put an object back where it started (and not carried). */
export function resetObject(o: WorldObject): void {
  o.carriedBy = null;
  setObjectPose(o, o.home.x, o.home.z, o.home.rot);
}

/** Put every object back where it started. */
export function resetAllObjects(): void { for (const o of list) if (!isAtHome(o)) resetObject(o); }

/** The objects that are not where they started (or are being carried): what a viewer, and the save, need to be told. */
export const movedObjects = (): WorldObject[] => list.filter(o => !isAtHome(o));
