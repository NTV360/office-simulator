import {
  CATALOGUE, carriedBy, inReach, isSeated, movability, objects, pickUp, placementProblem, putDown, resetObject, stationOwner,
  isAtHome, type Person, type Refusal, type WorldObject,
} from '@office/shared';

// What a player may do with the things in the office: pick one up, put it down, put things back. Every rule is decided here, from the
// shared placement rules (the page uses the same ones for its preview). A refusal says why, and changes nothing.
// See docs/PHASE-5-BREAKDOWN.md, step 4.

export type ObjectResult = { ok: true; changed: number } | { ok: false; reason: Refusal };
const no = (reason: Refusal): ObjectResult => ({ ok: false, reason });
const yes = (changed = 1): ObjectResult => ({ ok: true, changed });

/** May this account move this object? A thing in a shared area: anyone. A thing at a desk: only the person who plays that desk's owner. */
function mayMove(o: WorldObject, accountId: number): boolean {
  const owner = stationOwner(o);
  if (!owner) return true;
  return owner.account !== undefined && owner.account === accountId;
}

/** Pick up the object with this index. */
export function grab(person: Person, accountId: number, index: number): ObjectResult {
  if (isSeated(person) || carriedBy(person.id)) return no('busy');
  const o = Number.isInteger(index) ? objects.at(index) : undefined;
  if (!o) return no('not-movable');
  const refusal = movability(o);
  if (refusal) return no(refusal);
  if (!inReach(person, o.x, o.z)) return no('too-far');
  if (!mayMove(o, accountId)) return no('locked');
  pickUp(o, person.id);
  return yes();
}

/** Put down what the person carries at (x, z), facing `rot`. */
export function place(person: Person, accountId: number, x: number, z: number, rot: number): ObjectResult {
  const o = carriedBy(person.id);
  if (!o) return no('nothing-carried');
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) return no('blocked');
  if (!inReach(person, x, z)) return no('too-far');
  if (!mayMove(o, accountId)) return no('locked'); // (it was theirs to pick up; it must still be)
  const problem = placementProblem(o, x, z, rot);
  if (problem) return no(problem);
  putDown(o, x, z, rot);
  return yes();
}

/** Put one object back where it started. */
export function putBack(person: Person, accountId: number, index: number): ObjectResult {
  const o = Number.isInteger(index) ? objects.at(index) : undefined;
  if (!o) return no('not-movable');
  if (isSeated(person)) return no('busy');
  if (!inReach(person, o.x, o.z)) return no('too-far'); // (the same as picking up: you cannot undo what you could not touch)
  if (o.carriedBy !== null && o.carriedBy !== person.id) return no('carried');
  if (o.carriedBy === null) { const refusal = movability(o); if (refusal) return no(refusal); }
  if (!mayMove(o, accountId)) return no('locked');
  if (isAtHome(o)) return yes(0);
  if (!homeFree(o)) return no('crowded');
  resetObject(o);
  return yes();
}

/** Put everything at this person's own desk back where it started (what somebody is sitting in, and what is blocked, stays). */
export function putBackStation(person: Person, accountId: number): ObjectResult {
  const desk = person.slot;
  if (!desk) return no('locked');
  let changed = 0;
  for (const o of objects.all()) {
    if (o.station !== desk.id || !mayMove(o, accountId)) continue;
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
