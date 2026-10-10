import { findPath } from '../nav/astar';
import { walkPx } from '../nav/grid';
import { toPx, wx, wz } from '../plan';
import { deskSeat } from '../layout/desks';
import { interactables, type Spot } from '../sim/interactables';
import { ENTRY } from '../sim/spots';
import { people } from '../sim/state';
import { Vec3 } from '../vec3';
import { CATALOGUE, isMovableType } from './catalogue';
import { isAtHome, objects, type WorldObject } from './objects';

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
  | 'off-desk' // a small thing must stay on its own desk
  | 'locked' // it belongs to somebody else's station
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
  'off-desk': 'That has to stay on its desk.',
  locked: 'That belongs to somebody else\'s desk.',
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
  if (!isMovableType(o.type)) return 'not-movable';
  if (o.carriedBy !== null) return 'carried';
  const seat = seatOf(o);
  if (seat && seatInUse(seat)) return 'in-use';
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
function seatAt(o: WorldObject, x: number, z: number, rot: number): Vec3 | null {
  if (!o.link) return null;
  const { px, pz } = o.link;
  return new Vec3(x + px * Math.cos(rot) + pz * Math.sin(rot), 0, z - px * Math.sin(rot) + pz * Math.cos(rot));
}

/** Where the object's seat would be after the object is put at (x, z) facing `rot`: the point people walk to. */
function approachAt(o: WorldObject, x: number, z: number, rot: number): Vec3 | null {
  if (!o.link) return null;
  const { ax, az } = o.link;
  return new Vec3(x + ax * Math.cos(rot) + az * Math.sin(rot), 0, z - ax * Math.sin(rot) + az * Math.cos(rot));
}

/** The part of the desk top that is this station's: its column of the island (the width of one seat) and the island's depth, in metres: x from, x to, z from, z to; or null. */
function deskTop(o: WorldObject): [number, number, number, number] | null {
  const desk = interactables.all().find(s => s.id === o.station);
  const seat = desk?.deskId ? deskSeat(desk.deskId) : null;
  if (!seat) return null;
  const [x1, y1, x2, y2] = seat.island.rect, cw = (x2 - x1) / seat.island.cols, c = (seat.number - 1) % seat.island.cols;
  return [wx(x1 + c * cw), wx(x1 + (c + 1) * cw), wz(y1), wz(y2)];
}

const atHome = (o: WorldObject, x: number, z: number, rot: number): boolean => Math.hypot(x - o.home.x, z - o.home.z) < .01 && Math.abs(rot - o.home.rot) < .01;

/**
 * Whether `o` may be put at (x, z) facing `rot`: on floor people can walk on and not too close to another chair, with the seat still
 * walkable from the door; or, for a small thing, on its own desk and not on another small thing. Back where it started is always allowed.
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
    const top = deskTop(o);
    if (!home && !top) return 'off-desk';
    if (!home && top && (x < top[0] + me.radius || x > top[1] - me.radius || z < top[2] + me.radius || z > top[3] - me.radius)) return 'off-desk';
    for (const q of others) if (Math.hypot(q.x - x, q.z - z) < me.radius + CATALOGUE[q.type].radius && Math.abs(q.y - o.y) < .01) return 'crowded';
    return null;
  }
  const [px, py] = toPx({ x, z });
  if (!home && !walkPx(px, py)) return 'blocked';
  for (const q of others) if (Math.hypot(q.x - x, q.z - z) < me.radius + CATALOGUE[q.type].radius) return 'crowded';
  if (home) return null;
  const s = seatAt(o, x, z, rot);
  if (s) { const [sx, sy] = toPx(s); if (!walkPx(sx, sy)) return 'blocked'; } // (the seat itself on open floor: not against or inside a wall or a table)
  const a = approachAt(o, x, z, rot);
  if (a) {
    const [ax, ay] = toPx(a);
    if (!walkPx(ax, ay) || !findPath(ENTRY, a)) return 'unreachable';
  }
  return null;
}

/** Is the point within a person's reach? */
export const inReach = (person: { pos: { x: number; z: number } }, x: number, z: number): boolean => Math.hypot(person.pos.x - x, person.pos.z - z) <= REACH;

/** The movable object nearest to a point within `reach` that may be picked up now (ignoring who owns it), or null. */
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
