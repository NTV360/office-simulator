import { findPath } from '../nav/astar';
import { CS, walkPx } from '../nav/grid';
import { S, toPx, wx, wz } from '../plan';
import { DESK_ISLANDS } from '../layout/desks';
import { interactables, type Spot } from '../sim/interactables';
import { ENTRY } from '../sim/spots';
import { people } from '../sim/state';
import { Vec3 } from '../vec3';
import { CATALOGUE, DESK_TOP, isMovableType, shapeOf } from './catalogue';
import { footprintOf } from './footprint';
import { normalizeInventoryRotation } from '../sim/inventory';
import { isAtHome, objects, type Link, type WorldObject } from './objects';

// Where a world object may be put, and whether it may be moved at all. Plain functions over the shared data, so the server decides with
// exactly the rules the page uses to show a preview ("you can put it here"). Nothing here changes anything. See docs/PHASE-5-BREAKDOWN.md.

/** How far a person can reach to pick something up, or to put it down: metres from where they stand. */
export const REACH = 2.6;

/** Why a move was refused. The words are what the player is told (`REFUSAL_TEXT`). */
export type Refusal =
  | 'not-movable' // a kind that is fixed, or not an object at all
  | 'carried' // somebody has it already
  | 'in-use' // somebody sits in the chair, or is on their way to it
  | 'too-far' // out of reach
  | 'blocked' // not floor people can walk on
  | 'crowded' // too close to another thing
  | 'unreachable' // the seat could not be walked to from the door
  | 'off-desk' // a small thing must go on a desk or a table
  | 'locked' // not this person's desk (putting a whole desk back)
  | 'busy' // the person is sitting, or already carrying something
  | 'nothing-carried'
  | 'too-fast';

export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  'not-movable': 'That cannot be moved.',
  carried: 'Somebody is carrying that.',
  'in-use': 'Somebody is using that chair.',
  'too-far': 'That is too far to reach.',
  blocked: 'You cannot put it there.',
  crowded: 'There is something in the way there.',
  unreachable: 'Nobody could walk to the seat there.',
  'off-desk': 'That goes on a desk or a table.',
  locked: 'You do not have a desk of your own.',
  busy: 'Stand up and put down what you are carrying first.',
  'nothing-carried': 'You are not carrying anything.',
  'too-fast': 'Slow down a little.',
};

/** Is somebody sitting in this seat, or walking to it? (A seat nobody is using can be moved.) */
export function seatInUse(seat: Spot): boolean {
  if (seat.occupant != null) return true;
  return people.some(p => p.task?.spot === seat && p.state !== 'away');
}

/** The seat this object carries, if any. */
export const seatOf = (o: WorldObject): Spot | null => o.link?.spot ?? null;

/** Can this thing be picked up right now (whoever asks)? */
export function movability(o: WorldObject): Refusal | null {
  if (o.removed || !isMovableType(o.type)) return 'not-movable';
  if (o.carriedBy !== null) return 'carried';
  if (o.links.some(l => seatInUse(l.spot))) return 'in-use';
  return null;
}

/** The person who owns this object's station (the owner of its desk), or null for a thing in a shared area. */
export function stationOwner(o: WorldObject): { person: unknown; account: number | undefined } | null {
  if (!o.station) return null;
  const desk = interactables.all().find(s => s.id === o.station);
  const person = desk?.owner as { owner?: number } | null | undefined;
  return { person: person ?? null, account: person?.owner };
}

/** Where the object's seat itself would be after the object is put at (x, z) facing `rot`. */
const seatAt = (l: Link, x: number, z: number, rot: number): Vec3 => new Vec3(x + l.px * Math.cos(rot) + l.pz * Math.sin(rot), 0, z - l.px * Math.sin(rot) + l.pz * Math.cos(rot));

/** Where one of the object's spots would be after the object is put at (x, z) facing `rot`: the point people walk to. */
const approachAt = (l: Link, x: number, z: number, rot: number): Vec3 => new Vec3(x + l.ax * Math.cos(rot) + l.az * Math.sin(rot), 0, z - l.ax * Math.sin(rot) + l.az * Math.cos(rot));

/** Is all the floor this thing would cover at (x, z), facing `rot`, open floor now (no wall, fixed furniture or other big thing)? */
function footprintFree(o: WorldObject, x: number, z: number, rot: number): boolean {
  const rect = footprintOf({ ...o, x, z, rot, q: null, carriedBy: null });
  if (!rect) return true;
  for (let py = rect[1]; py <= rect[3] + 1e-9; py += Math.min(CS, rect[3] - rect[1] || CS)) for (let px = rect[0]; px <= rect[2] + 1e-9; px += Math.min(CS, rect[2] - rect[0] || CS)) {
    if (!walkPx(px, py) && !inOwnFootprint(o, px, py)) return false;
  }
  return true;
}

/** Is this point (plan pixels) on the floor the thing itself blocks where it stands now? (Moving a table a little is not blocked by the table.) */
function inOwnFootprint(o: WorldObject, px: number, py: number): boolean {
  const r = footprintOf(o), m = 7; // (the walk grid's margin round an obstacle, and a little)
  return !!r && px > r[0] - m && px < r[2] + m && py > r[1] - m && py < r[3] + m;
}

/** The desk top under a point: one column of an island (the width of one seat, between the screens) and the island's depth, in metres: x from, x to, z from, z to; or null. Any desk will do: anyone may put things on anyone's desk. */
function deskTopAt(x: number, z: number): [number, number, number, number] | null {
  for (const isl of DESK_ISLANDS) {
    const [x1, y1, x2, y2] = isl.rect, cw = (x2 - x1) / isl.cols;
    if (x < wx(x1) || x > wx(x2) || z < wz(y1) || z > wz(y2)) continue;
    const c = Math.min(isl.cols - 1, Math.floor((x - wx(x1)) / (wx(x1 + cw) - wx(x1))));
    return [wx(x1 + c * cw), wx(x1 + (c + 1) * cw), wz(y1), wz(y2)];
  }
  return null;
}

/** A fixed top small things may be put on besides the desks (a conference table, the kitchen counter): [x1, y1, x2, y2] in plan pixels, and its height in metres. */
export type FixedTop = readonly [number, number, number, number, number];
let fixedTops: readonly FixedTop[] = [];
/** The fixed tops of the office, from the layout data (`loadLayout` sets them). */
export function setFixedTops(tops: readonly FixedTop[]): void { fixedTops = tops; }

/**
 * The height a thing of this kind would stand at, put at (x, z): 0 on the floor for a chair; for a small thing the highest top under it that
 * it fits on, a desk (anyone's), a fixed top, or an item's top (a table, a cabinet) that is standing upright; or null when there is none.
 */
export function restHeightAt(o: WorldObject, x: number, z: number): number | null {
  const me = CATALOGUE[o.type];
  if (me.rests === 'floor') return 0;
  const r = me.radius;
  let best: number | null = null;
  const desk = deskTopAt(x, z);
  if (desk && x >= desk[0] + r && x <= desk[1] - r && z >= desk[2] + r && z <= desk[3] - r) best = DESK_TOP;
  const [px, py] = toPx({ x, z }), rp = r / S;
  for (const t of fixedTops) if (px >= t[0] + rp && px <= t[2] - rp && py >= t[1] + rp && py <= t[3] - rp && (best === null || t[4] > best)) best = t[4];
  for (const q of objects.all()) {
    const top = q === o || q.carriedBy !== null || q.q !== null ? undefined : shapeOf(q).top;
    if (!top) continue;
    const dx = x - q.x, dz = z - q.z, c = Math.cos(q.rot), s = Math.sin(q.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c; // (into its own frame, as objects.ts turns a seat)
    if (Math.abs(lx) <= top.hw - r && Math.abs(lz) <= top.hd - r && (best === null || q.y + top.y > best)) best = q.y + top.y;
  }
  return best;
}

const atHome = (o: WorldObject, x: number, z: number, rot: number): boolean => Math.hypot(x - o.home.x, z - o.home.z) < .01 && Math.abs(rot - o.home.rot) < .01;

/**
 * Whether `o` may be put at (x, z) facing `rot`: on floor people can walk on and not too close to another chair, with the seat still
 * walkable from the door; or, for a small thing, on a desk (anyone's) or a table, and not on another small thing. Back where it started is always allowed.
 */
export function placementProblem(o: WorldObject, x: number, z: number, rot: number): Refusal | null {
  if (!isMovableType(o.type)) return 'not-movable';
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) return 'blocked';
  // (the starting place is where the layout put it: it is always a place it may go back to, so it is not asked to be floor, on a desk or reachable; but if another
  // thing has been put there since, it is crowded like anywhere else)
  const home = atHome(o, x, z, rot);
  const me = CATALOGUE[o.type];
  const others = objects.all().filter(q => q !== o && q.carriedBy === null && CATALOGUE[q.type].rests === me.rests);
  if (me.rests === 'surface') {
    const y = home ? o.home.y : restHeightAt(o, x, z);
    if (y === null) return 'off-desk';
    for (const q of others) if (Math.hypot(q.x - x, q.z - z) < me.radius + CATALOGUE[q.type].radius && Math.abs(q.y - y) < .01) return 'crowded';
    return null;
  }
  const [px, py] = toPx({ x, z });
  const big = shapeOf(o).foot !== undefined;
  if (!home && !walkPx(px, py) && !inOwnFootprint(o, px, py)) return 'blocked';
  // (big things keep each other apart on the walk grid, and a chair stands close to its table: the crowding circles are for chairs and stools)
  if (!big) for (const q of others) if (shapeOf(q).foot === undefined && Math.hypot(q.x - x, q.z - z) < me.radius + CATALOGUE[q.type].radius) return 'crowded';
  if (home) return null;
  if (!footprintFree(o, x, z, rot)) return 'blocked'; // (a table or a sofa: all of it on open floor)
  for (const l of o.links) {
    // (the seat itself on open floor: not against or inside a wall or a table. A sofa's seats are on the sofa, which is not down yet)
    if (!big) { const [sx, sy] = toPx(seatAt(l, x, z, rot)); if (!walkPx(sx, sy)) return 'blocked'; }
    const a = approachAt(l, x, z, rot), [ax, ay] = toPx(a);
    if (!walkPx(ax, ay) || !findPath(ENTRY, a)) return 'unreachable';
  }
  return null;
}

/**
 * Whether a direct horizontal line between two people stays in walkable space.
 * This is deliberately a conservative, shared-grid test: the server uses it for
 * short-range interactions and the client can use the same rule for previews.
 */
export function hasLineOfSight(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return false;
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (distance < 1e-9) return true;
  const [ax, az] = toPx(a), [bx, bz] = toPx(b);
  const cells = Math.ceil(distance / (CS * S * .4));
  for (let i = 1; i < cells; i++) {
    const t = i / cells;
    if (!walkPx(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/** Is the point within a person's reach? */
export const inReach = (person: { pos: { x: number; z: number } }, x: number, z: number): boolean => Math.hypot(person.pos.x - x, person.pos.z - z) <= REACH;

/** The movable object nearest to a point within `reach` that may be picked up now, or null. */
export function nearestMovable(x: number, z: number, reach = REACH): WorldObject | null {
  let best: WorldObject | null = null, bd = reach;
  for (const o of objects.all()) {
    if (movability(o) !== null) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export { isAtHome };

/** The radius reserved around a person while an item is introduced from inventory. */
export const CHARACTER_CLEARANCE_RADIUS = .35;

export interface InventoryDropPerson {
  pos: { x: number; z: number };
  face: number;
}

export interface InventoryDropPlacement {
  x: number;
  z: number;
  rot: number;
  y: number;
}

/** A side-effect-free object shape used to run the same placement rules before creating a world object. */
function placementProbe(type: string, x: number, z: number, rot: number): WorldObject {
  const home = { x: x + 10000, z: z + 10000, rot: rot + 1, y: 0 };
  return {
    id: 'inventory-probe', index: -1, type, x, z, rot, y: 0, variant: 0, station: null, spot: null,
    home, carriedBy: null, q: null, link: null, links: [], holds: [], helpers: [], removed: false,
  };
}

function characterClear(o: WorldObject, x: number, z: number, person: InventoryDropPerson): boolean {
  const radius = CHARACTER_CLEARANCE_RADIUS + CATALOGUE[o.type].radius;
  // Include every live character: a drop must not materialize inside the player or an NPC.
  return people.every(other => Math.hypot(other.pos.x - x, other.pos.z - z) >= radius)
    && Math.hypot(person.pos.x - x, person.pos.z - z) >= radius;
}

/**
 * Find a safe place to drag an inventory item out in front of a character. This only reads shared world state;
 * callers can preview it on the client and re-run it authoritatively on the server. Candidates are deterministic:
 * the point in front first, then expanding rings around it. No inventory or world object is changed here.
 */
export function findInventoryDropPlacement(
  item: { type: string; rotation?: number },
  person: InventoryDropPerson,
  options: { distance?: number; maxFallbackRadius?: number; rotation?: number } = {},
): InventoryDropPlacement | null {
  const distance = Number.isFinite(options.distance) ? Math.max(0, options.distance!) : .8;
  const maxFallbackRadius = Number.isFinite(options.maxFallbackRadius) ? Math.max(0, options.maxFallbackRadius!) : 1.5;
  const rotation = options.rotation ?? item.rotation ?? 0;
  if (!CATALOGUE[item.type] || !Number.isFinite(person.pos.x) || !Number.isFinite(person.pos.z) || !Number.isFinite(person.face)) return null;
  if (rotation !== 0 && rotation !== 90) return null;
  const normalizedRotation = normalizeInventoryRotation(item.type, rotation);
  const rot = person.face + normalizedRotation * Math.PI / 180;
  const fx = Math.sin(person.face), fz = Math.cos(person.face);
  const candidates: Array<{ x: number; z: number }> = [{ x: person.pos.x + fx * distance, z: person.pos.z + fz * distance }];
  for (let radius = .15; radius <= maxFallbackRadius + 1e-9; radius += .15) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      candidates.push({ x: person.pos.x + fx * distance + Math.cos(angle) * radius, z: person.pos.z + fz * distance + Math.sin(angle) * radius });
    }
  }
  const probe = placementProbe(item.type, 0, 0, rot);
  for (const candidate of candidates) {
    probe.x = candidate.x; probe.z = candidate.z; probe.rot = rot;
    if (!inReach(person, candidate.x, candidate.z) || !characterClear(probe, candidate.x, candidate.z, person)) continue;
    if (placementProblem(probe, candidate.x, candidate.z, rot) !== null) continue;
    const y = restHeightAt(probe, candidate.x, candidate.z);
    if (y === null) continue;
    return { x: candidate.x, z: candidate.z, rot, y };
  }
  return null;
}
