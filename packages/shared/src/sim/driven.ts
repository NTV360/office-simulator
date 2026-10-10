import { OX, OY, S } from '../plan';
import { walkPx } from '../nav/grid';
import { stepPlayer } from './locomotion';
import { CATALOGUE, carryOf } from '../world/catalogue';
import { carriedBy, holderCount, seatUnusable } from '../world/objects';
import { interactables, type Spot } from './interactables';
import { people } from './state';
import type { Person } from './types';

// Moving and sitting a person a human drives. The browser sends inputs (which way, how fast, which way it faces) and asks to
// sit or stand; this is what the server does with them. The human never sends a position, so they cannot be anywhere the
// rules do not allow. See docs/PHASE-3-BREAKDOWN.md, step 4.

/** Metres per second. */
export const WALK_SPEED = 1.5;
export const RUN_SPEED = 3;

/**
 * How fast a person carrying something may go: their share of its weight (shared between everyone holding it) slows them, kg / 40 at a
 * time, and only a light thing (one hand) can be run with. Nothing carried: full speed. The page predicts with the same numbers.
 */
export function carryPace(personId: number): { factor: number; run: boolean } {
  const o = carriedBy(personId);
  if (!o) return { factor: 1, run: true };
  const share = CATALOGUE[o.type].mass / Math.max(1, holderCount(o));
  return { factor: 1 / (1 + share / 40), run: carryOf(o.type) === 'one-hand' };
}
/** How far from a seat a person can be and still sit in it, in metres. */
export const SEAT_REACH = 1.15;
/** Below this stick strength nothing happens (a resting thumb). */
const DEAD_ZONE = 0.08;
/** No single movement step is longer than this, so a fast step cannot jump over a thin wall. */
const MAX_SUBSTEP = 0.25;
/** How long an input is believed with no newer one, in seconds. */
export const INPUT_STALE_SECONDS = 0.25;
/** The seat's own furniture stands in the way of the last stretch; a wall must not be anywhere before it. */
const SEAT_MARGIN = 0.6;

/** What the human is asking for right now. */
export interface DrivenInput {
  /** Counts up with each message from this client; an old or repeated one is ignored. */
  seq: number;
  /** Which way to go in the world (x and z), as a fraction of full speed: at most length 1. */
  mx: number;
  mz: number;
  /** Which way to face, in radians. */
  heading: number;
  run: boolean;
  /** The server tick it arrived on (set by the server, not the client). */
  tick: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check an input from outside and make it safe: finite numbers, a direction no longer than 1, a heading in a sane range.
 * Returns null if it is not an input at all.
 */
export function sanitizeInput(raw: unknown, tick: number): DrivenInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.seq) || !finite(r.mx) || !finite(r.mz) || !finite(r.heading)) return null;
  let { mx, mz } = r as { mx: number; mz: number };
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; } // never faster than full speed, whatever was sent
  const heading = ((r.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return { seq: r.seq, mx, mz, heading, run: r.run === true, tick };
}

// ---- seats

/** The kinds of place a person can sit. */
const SEAT_KINDS = ['desk', 'conf', 'dining', 'lounge', 'bar', 'booth', 'music'] as const;

/** Is the floor clear between two points, apart from the last `ignoreLast` metres (the seat's own furniture)? Walls and furniture block. */
export function clearBetween(from: { x: number; z: number }, to: { x: number; z: number }, ignoreLast = 0): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  const checked = Math.max(0, d - ignoreLast);
  for (let t = 0; t <= checked; t += 0.1) {
    const k = d === 0 ? 0 : t / d;
    const x = from.x + dx * k, z = from.z + dz * k;
    if (t > 0 && !walkPx(x / S + OX, z / S + OY)) return false;
  }
  return true;
}

/**
 * Can this person sit here? Nobody else may be in it (a shared seat, or a desk someone is sitting at); a desk must be theirs, or
 * its owner must be away. They must be in the building, driven by a human, and there must be a clear way to the seat.
 */
export function seatOK(spot: Spot, p: Person): boolean {
  if (seatUnusable(spot)) return false; // the chair is in somebody's hands, or knocked over
  if (spot.occupant && spot.occupant !== p) return false;
  if (!spot.shared) {
    const owner = spot.owner as Person | null | undefined;
    if (owner && owner !== p && owner.state !== 'away') return false;
  }
  return true;
}

/** The nearest seat within reach that this person may sit in, or null. */
export function nearestSeat(p: Person): Spot | null {
  let best: Spot | null = null, bestDistance = SEAT_REACH;
  for (const kind of SEAT_KINDS) {
    for (const spot of interactables.of(kind)) {
      if (!seatOK(spot, p)) continue;
      const d = Math.hypot(spot.pos.x - p.pos.x, spot.pos.z - p.pos.z);
      if (d < bestDistance && clearBetween(p.pos, spot.pos, SEAT_MARGIN)) { bestDistance = d; best = spot; }
    }
  }
  return best;
}

/** Is this person sitting (as a human asked them to)? */
export const isSeated = (p: Person): boolean => p.task?.kind === 'playerSit';

const seatAnim = (spot: Spot, p: Person): string =>
  spot.kind === 'piano' ? 'piano' : spot.kind === 'guitar' ? 'guitar' : spot.game ? 'game'
    : spot.kind === 'desk' ? (spot.owner === p ? 'type' : 'listenSit') : spot.kind === 'booth' ? 'phone' : spot.kind === 'bar' ? 'drinkSit' : 'listenSit';

function putDownProps(p: Person): void {
  p.props.pad = p.props.phone = p.props.mug = p.props.guitar = false;
}

/** Sit in the nearest allowed seat. Returns false (and changes nothing) if there is none, the person is already sitting, or no human drives them. */
export function sit(p: Person): boolean {
  if (p.controller !== 'account' || isSeated(p) || carriedBy(p.id)) return false; // (put down what you carry first)
  const spot = nearestSeat(p);
  if (!spot) return false;
  spot.occupant = p; // whether the seat is shared or a desk, nobody else sits in it now
  p.pos.x = spot.pos.x; p.pos.z = spot.pos.z;
  p.face = p.faceGoal = spot.face;
  p.task = { kind: 'playerSit', cat: 'work', anim: seatAnim(spot, p), spot, onEnd: putDownProps };
  p.props.pad = !!spot.game; p.props.guitar = spot.kind === 'guitar'; p.props.phone = spot.kind === 'booth'; p.props.mug = spot.kind === 'bar';
  return true;
}

/** Stand up from where they sit: they end up at the seat's approach point. Returns false if they were not sitting. */
export function stand(p: Person): boolean {
  const t = p.task;
  if (!t || t.kind !== 'playerSit') return false;
  if (t.spot.occupant === p) t.spot.occupant = null;
  p.pos.x = t.spot.approach.x; p.pos.z = t.spot.approach.z;
  putDownProps(p);
  p.task = null;
  return true;
}

// ---- moving

/**
 * Move a driven person for one tick (`dt` seconds) according to their latest input. A person who is sitting stays put unless
 * the input asks to move, which first makes them stand. No input, or an old one (more than `staleTicks` ticks old), means they
 * are not moving. Returns the distance moved.
 */
export function stepDriven(p: Person, input: DrivenInput | null, dt: number, tick: number, others: readonly Person[] = people, staleTicks = 5): number {
  p.animT += dt;
  // an input is believed for a short while; one from the future (after a world reset) is not believed either
  const live = input !== null && tick - input.tick >= 0 && tick - input.tick <= staleTicks ? input : null;
  if (live) p.faceGoal = live.heading;
  if (isSeated(p)) {
    p.face = p.faceGoal = p.task!.spot.face;
    if (!live || Math.hypot(live.mx, live.mz) <= DEAD_ZONE) return 0;
    stand(p); // moving gets them out of the chair first
  }
  if (!live) return 0;
  const len = Math.hypot(live.mx, live.mz);
  if (len <= DEAD_ZONE) { p.face = p.faceGoal = live.heading; return 0; }
  const pace = carryPace(p.id);
  const speed = (live.run && pace.run ? RUN_SPEED : WALK_SPEED) * pace.factor * Math.min(1, len) * dt;
  // in short steps, so a fast tick cannot jump over a thin wall
  const steps = Math.max(1, Math.ceil(speed / MAX_SUBSTEP));
  let moved = 0;
  for (let i = 0; i < steps; i++) moved += stepPlayer(p, live.mx / len * speed / steps, live.mz / len * speed / steps, others);
  p.face = p.faceGoal = live.heading;
  p.walkPhase += moved * 4.6;
  return moved;
}

/** Everyone a human is driving gets one tick of movement, from the inputs `inputs` holds for them (keyed by person id). */
export function stepAllDriven(inputs: ReadonlyMap<number, DrivenInput>, dt: number, tick: number): void {
  const staleTicks = Math.max(2, Math.ceil(INPUT_STALE_SECONDS / dt)); // a quarter of a second, whatever the tick rate
  for (const p of people) {
    if (p.controller !== 'account') continue;
    stepDriven(p, inputs.get(p.id) ?? null, dt, tick, people, staleTicks);
  }
}
