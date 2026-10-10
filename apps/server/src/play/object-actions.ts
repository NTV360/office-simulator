import {
  CATALOGUE, canReach, carriedBy, inReach, isSeated, movability, mulQuat, nearestGrip, objects, onItem, orientationOf, pickUp, placementProblem, putDown, resetObject, restHeightAt, toItemFrame,
  type Hold, type Quat,
  isAtHome, type Person, type Refusal, type WorldObject,
} from '@office/shared';

// What a player may do with the things in the office: pick one up, put it down, put things back. Every rule is decided here, from the
// shared placement rules (the page uses the same ones for its preview). A refusal says why, and changes nothing. Anyone may move anything,
// at anyone's desk: a thing's station only records whose it is. See docs/PHASE-5-BREAKDOWN.md, step 4, and docs/ITEMS-PHYSICS-PLAN.md.

export type ObjectResult = { ok: true; changed: number } | { ok: false; reason: Refusal };
const no = (reason: Refusal): ObjectResult => ({ ok: false, reason });
const yes = (changed = 1): ObjectResult => ({ ok: true, changed });

/** Take hold of the object with this index, at the point of it the player aimed at (or, if they did not say, the point nearest them). */
export function grab(person: Person, index: number, at?: readonly number[]): ObjectResult {
  if (isSeated(person) || carriedBy(person.id)) return no('busy');
  const o = Number.isInteger(index) ? objects.at(index) : undefined;
  if (!o) return no('not-movable');
  const refusal = movability(o);
  if (refusal) return no(refusal);
  const aimed = at && at.length === 3 && at.every(Number.isFinite) ? { x: at[0], y: at[1], z: at[2] } : null;
  if (aimed && !onItem(o, aimed)) return no('too-far'); // (a point that is not on it at all)
  const point = aimed ?? nearestGrip(o, person);
  if (!canReach(person, point)) return no('too-far');
  pickUp(o, person.id, holdFor(o, person, point));
  return yes();
}

/** A hold that keeps the item as it is to this person now: their hands where they took it, its angle to them as it is. */
function holdFor(o: WorldObject, person: Person, point: { x: number; y: number; z: number }): Hold {
  const half = person.face / 2, facing: Quat = [0, -Math.sin(half), 0, Math.cos(half)]; // (the inverse of the way they face)
  return { person: person.id, at: toItemFrame(o, point), rel: mulQuat(facing, orientationOf(o)), turn: [0, 0, 0, 1], lift: point.y, out: Math.hypot(point.x - person.pos.x, point.z - person.pos.z) };
}

/** Put down what the person carries at (x, z), facing `rot`. */
export function place(person: Person, x: number, z: number, rot: number): ObjectResult {
  const o = carriedBy(person.id);
  if (!o) return no('nothing-carried');
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) return no('blocked');
  if (!inReach(person, x, z)) return no('too-far');
  const problem = placementProblem(o, x, z, rot);
  if (problem) return no(problem);
  const back = Math.hypot(x - o.home.x, z - o.home.z) < .01;
  putDown(o, x, z, rot, back ? o.home.y : restHeightAt(o, x, z) ?? o.home.y);
  return yes();
}

/** Put one object back where it started. */
export function putBack(person: Person, index: number): ObjectResult {
  const o = Number.isInteger(index) ? objects.at(index) : undefined;
  if (!o) return no('not-movable');
  if (isSeated(person)) return no('busy');
  if (!inReach(person, o.x, o.z)) return no('too-far'); // (the same as picking up: you cannot undo what you could not touch)
  if (o.carriedBy !== null && o.carriedBy !== person.id) return no('carried');
  if (o.carriedBy === null) { const refusal = movability(o); if (refusal) return no(refusal); }
  if (isAtHome(o)) return yes(0);
  if (!homeFree(o)) return no('crowded');
  resetObject(o);
  return yes();
}

/** Put everything at this person's own desk back where it started (what somebody is sitting in, and what is blocked, stays). */
export function putBackStation(person: Person): ObjectResult {
  const desk = person.slot;
  if (!desk) return no('locked');
  let changed = 0;
  for (const o of objects.all()) {
    if (o.station !== desk.id) continue;
    if (o.carriedBy !== null && o.carriedBy !== person.id) continue;
    if (o.carriedBy === null && movability(o)) continue;
    if (isAtHome(o) || !homeFree(o)) continue;
    resetObject(o);
    changed++;
  }
  return yes(changed);
}

/** Is where it started free? (Somebody may have put another chair there.) */
function homeFree(o: WorldObject): boolean {
  const me = CATALOGUE[o.type];
  return !objects.all().some(q => q !== o && q.carriedBy === null && CATALOGUE[q.type].rests === me.rests && Math.hypot(q.x - o.home.x, q.z - o.home.z) < me.radius + CATALOGUE[q.type].radius);
}
