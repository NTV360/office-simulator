import { supportAt, walkPx } from "../nav/grid";
import { OX, OY, S } from "../plan";
import { carryOf, CATALOGUE, shapeOf } from "../world/catalogue";
import {
  carriedBy,
  holderCount,
  objects,
  seatUnusable,
  type WorldObject,
} from "../world/objects";
import { characterHolds } from "./character-hold-actions";
import {
  adjustCrouch,
  canMove,
  JUMP,
  postureSpeedFactor,
} from "./character-state";
import {
  freeSitClearOccupant,
  freeSitIsOccupied,
  freeSitOccupant,
  freeSitSetOccupant,
} from "./free-sit-state";
import {
  classifyFreeSitting,
  type FreeSitClassification,
  type FreeSitSupport,
  type SittingPoint,
} from "./free-sitting";
import { interactables, type Spot } from "./interactables";
import { stepPlayer } from "./locomotion";
import { people } from "./state";
import type { Person } from "./types";

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
  return { factor: 1 / (1 + share / 40), run: carryOf(o.type) === "one-hand" };
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
const FREE_SEAT_EDGE = 0.2;
const FREE_SEAT_REACH = 1.15;

/** Whether an arbitrary support currently has a person sitting on it. */
export function freeSitOccupied(o: WorldObject): boolean {
  return freeSitIsOccupied(o);
}

/** Convert a rectangular catalogue top into the pure free-sitting support model. */
export function freeSitSupport(o: WorldObject): FreeSitSupport | null {
  if (o.removed || o.carriedBy !== null || o.q !== null) return null;
  const shape = shapeOf(o);
  const top = shape.top;
  // Registered chairs retain the driven Spot path; only unregistered, explicitly surface furniture can be free-sit supports.
  if (
    o.link ||
    ["chair-office", "chair-wood", "stool-bar", "stool-low"].includes(o.type) ||
    !top ||
    !CATALOGUE[o.type]?.surface
  )
    return null;
  return {
    center: { x: o.x, z: o.z },
    halfWidth: top.hw,
    halfDepth: top.hd,
    topY: o.y + top.y,
    rotation: o.rot,
    occupant: freeSitOccupant(o),
  };
}

function insideSupport(point: SittingPoint, support: FreeSitSupport): boolean {
  const r = support.rotation ?? 0;
  const dx = point.x - support.center.x,
    dz = point.z - support.center.z;
  const x = dx * Math.cos(r) - dz * Math.sin(r),
    z = dx * Math.sin(r) + dz * Math.cos(r);
  return (
    Math.abs(x) <= (support.halfWidth ?? 0) &&
    Math.abs(z) <= (support.halfDepth ?? 0)
  );
}

function freeSupportCandidate(p: Person): {
  object: WorldObject;
  support: FreeSitSupport;
  position: SittingPoint;
  heading: number;
} | null {
  let best: {
    object: WorldObject;
    support: FreeSitSupport;
    position: SittingPoint;
    heading: number;
  } | null = null;
  let bestDistance = FREE_SEAT_REACH;
  for (const o of objects.all()) {
    const support = freeSitSupport(o);
    if (!support || (support.occupant && support.occupant !== p)) continue;
    const r = support.rotation ?? 0,
      c = Math.cos(r),
      s = Math.sin(r);
    const dx = p.pos.x - support.center.x,
      dz = p.pos.z - support.center.z;
    const lx = dx * c - dz * s,
      lz = dx * s + dz * c;
    const hw = support.halfWidth ?? 0,
      hd = support.halfDepth ?? 0;
    const px = Math.max(
      -hw + FREE_SEAT_EDGE,
      Math.min(hw - FREE_SEAT_EDGE, lx),
    );
    const pz = Math.max(
      -hd + FREE_SEAT_EDGE,
      Math.min(hd - FREE_SEAT_EDGE, lz),
    );
    if (hw <= FREE_SEAT_EDGE || hd <= FREE_SEAT_EDGE) continue;
    const position = {
      x: support.center.x + px * c - pz * s,
      z: support.center.z + px * s + pz * c,
    };
    const distance = Math.hypot(position.x - p.pos.x, position.z - p.pos.z);
    if (distance >= bestDistance || !clearBetween(p.pos, position, SEAT_MARGIN))
      continue;
    const heading = Math.atan2(p.pos.x - position.x, p.pos.z - position.z);
    best = { object: o, support, position, heading };
    bestDistance = distance;
  }
  return best;
}

/** Validate and enter the nearest arbitrary rectangular support, after registered chairs are tried. */
export function sitFree(p: Person): boolean {
  if (
    p.controller !== "account" ||
    isSeated(p) ||
    carriedBy(p.id) ||
    inCharacterHold(p)
  )
    return false;
  const candidate = freeSupportCandidate(p);
  if (!candidate) return false;
  const { object, support, position, heading } = candidate;
  // The body may occupy the support, but stand-up candidates must be clear floor outside it.
  const clear = (point: SittingPoint): boolean =>
    insideSupport(point, support) || walkPx(point.x / S + OX, point.z / S + OY);
  const floorClear = (point: SittingPoint): boolean =>
    !insideSupport(point, support) &&
    walkPx(point.x / S + OX, point.z / S + OY);
  const stand = {
    x: position.x + Math.sin(heading) * 0.8,
    z: position.z + Math.cos(heading) * 0.8,
  };
  const result: FreeSitClassification = classifyFreeSitting({
    support,
    position,
    heading,
    person: p,
    isClear: clear,
    standUpCandidates: [stand],
  });
  if (result.ok && !floorClear(result.standUp)) return false;
  if (!result.ok) return false;
  freeSitSetOccupant(object, p);
  p.pos.x = position.x;
  p.pos.z = position.z;
  p.face = p.faceGoal = heading;
  p.mechanics.posture = "seated";
  p.mechanics.seatMode = result.mode;
  p.mechanics.seatId = object.id;
  p.mechanics.crouchLevel = 0;
  p.mechanics.grounded = true;
  p.mechanics.locomotion = "grid";
  const spot: any = {
    kind: "free-sit",
    pos: { ...position },
    approach: result.standUp,
    face: heading,
    hipY: Math.max(0.2, support.topY - 0.22),
    shared: true,
    place: object.id,
    occupant: p,
    freeObject: object,
  };
  p.task = {
    kind: "playerSit",
    cat: "break",
    anim: result.mode === "free-crossed" ? "sitCrossed" : "sit",
    spot,
    onEnd: (q) => {
      freeSitClearOccupant(object);
      putDownProps(q);
    },
  };
  putDownProps(p);
  return true;
}

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
  /** Character posture intents are optional so old clients remain movement-compatible. */
  crouch?: boolean;
  crouchWheel?: number;
  prone?: boolean;
  jump?: boolean;
  /** Held-character escape effort, evaluated by the server from the latest input. */
  struggle?: boolean;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Check an input from outside and make it safe: finite numbers, a direction no longer than 1, a heading in a sane range.
 * Returns null if it is not an input at all.
 */
export function sanitizeInput(raw: unknown, tick: number): DrivenInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.seq) || !finite(r.mx) || !finite(r.mz) || !finite(r.heading))
    return null;
  let { mx, mz } = r as { mx: number; mz: number };
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  } // never faster than full speed, whatever was sent
  const heading = ((r.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const out: DrivenInput = {
    seq: r.seq,
    mx,
    mz,
    heading,
    run: r.run === true,
    tick,
  };
  if (r.crouch === true) out.crouch = true;
  if (finite(r.crouchWheel) && r.crouchWheel !== 0)
    out.crouchWheel = r.crouchWheel;
  if (r.prone === true) out.prone = true;
  if (r.jump === true) out.jump = true;
  if (r.struggle === true) out.struggle = true;
  return out;
}

// ---- seats

/** The kinds of place a person can sit. */
const SEAT_KINDS = [
  "desk",
  "conf",
  "dining",
  "lounge",
  "bar",
  "booth",
  "music",
] as const;

/** Is the floor clear between two points, apart from the last `ignoreLast` metres (the seat's own furniture)? Walls and furniture block. */
export function clearBetween(
  from: { x: number; z: number },
  to: { x: number; z: number },
  ignoreLast = 0,
): boolean {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    d = Math.hypot(dx, dz);
  const checked = Math.max(0, d - ignoreLast);
  for (let t = 0; t <= checked; t += 0.1) {
    const k = d === 0 ? 0 : t / d;
    const x = from.x + dx * k,
      z = from.z + dz * k;
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
    if (owner && owner !== p && owner.state !== "away") return false;
  }
  return true;
}

/** The nearest seat within reach that this person may sit in, or null. */
export function nearestSeat(p: Person): Spot | null {
  let best: Spot | null = null,
    bestDistance = SEAT_REACH;
  for (const kind of SEAT_KINDS) {
    for (const spot of interactables.of(kind)) {
      if (!seatOK(spot, p)) continue;
      const d = Math.hypot(spot.pos.x - p.pos.x, spot.pos.z - p.pos.z);
      if (d < bestDistance && clearBetween(p.pos, spot.pos, SEAT_MARGIN)) {
        bestDistance = d;
        best = spot;
      }
    }
  }
  return best;
}

/** Is this person sitting (as a human asked them to)? */
export const isSeated = (p: Person): boolean => p.task?.kind === "playerSit";

const seatAnim = (spot: Spot, p: Person): string =>
  spot.kind === "piano"
    ? "piano"
    : spot.kind === "guitar"
      ? "guitar"
      : spot.game
        ? "game"
        : spot.kind === "desk"
          ? spot.owner === p
            ? "type"
            : "listenSit"
          : spot.kind === "booth"
            ? "phone"
            : spot.kind === "bar"
              ? "drinkSit"
              : "listenSit";

function putDownProps(p: Person): void {
  p.props.pad = p.props.phone = p.props.mug = p.props.guitar = false;
}

/** Is this person holding somebody, or held by somebody? Hold poses are written every tick, so neither may take a seat. */
const inCharacterHold = (p: Person): boolean =>
  !!characterHolds.getHeld(p.id) || !!characterHolds.getHolder(p.id);

/** Sit in the nearest allowed seat. Returns false (and changes nothing) if there is none, the person is already sitting, or no human drives them. */
export function sit(p: Person): boolean {
  if (
    p.controller !== "account" ||
    isSeated(p) ||
    carriedBy(p.id) ||
    inCharacterHold(p)
  )
    return false; // (put down what you carry first)
  const spot = nearestSeat(p);
  if (!spot) return false;
  spot.occupant = p; // whether the seat is shared or a desk, nobody else sits in it now
  p.pos.x = spot.pos.x;
  p.pos.z = spot.pos.z;
  p.face = p.faceGoal = spot.face;
  p.mechanics.posture = "seated";
  p.mechanics.seatMode = "fixed-chair";
  p.mechanics.seatId = spot.id;
  p.mechanics.crouchLevel = 0;
  p.mechanics.grounded = true;
  p.mechanics.locomotion = "grid";
  p.task = {
    kind: "playerSit",
    cat: "work",
    anim: seatAnim(spot, p),
    spot,
    onEnd: putDownProps,
  };
  p.props.pad = !!spot.game;
  p.props.guitar = spot.kind === "guitar";
  p.props.phone = spot.kind === "booth";
  p.props.mug = spot.kind === "bar";
  return true;
}

/** Stand up from where they sit: they end up at the seat's approach point. Returns false if they were not sitting. */
export function stand(p: Person): boolean {
  const t = p.task;
  if (!t || t.kind !== "playerSit") return false;
  const freeObject = (t.spot as { freeObject?: WorldObject }).freeObject;
  if (freeObject) freeSitClearOccupant(freeObject);
  if (t.spot.occupant === p) t.spot.occupant = null;
  p.pos.x = t.spot.approach.x;
  p.pos.z = t.spot.approach.z;
  putDownProps(p);
  p.task = null;
  p.mechanics.posture = "standing";
  p.mechanics.seatMode = "none";
  p.mechanics.seatId = null;
  p.mechanics.grounded = true;
  p.mechanics.locomotion = "grid";
  return true;
}

// ---- moving

/**
 * Move a driven person for one tick (`dt` seconds) according to their latest input. A person who is sitting stays put unless
 * the input asks to move, which first makes them stand. No input, or an old one (more than `staleTicks` ticks old), means they
 * are not moving. Returns the distance moved.
 */
export function stepDriven(
  p: Person,
  input: DrivenInput | null,
  dt: number,
  tick: number,
  others: readonly Person[] = people,
  staleTicks = 5,
): number {
  p.animT += dt;
  // an input is believed for a short while; one from the future (after a world reset) is not believed either
  const live =
    input !== null && tick - input.tick >= 0 && tick - input.tick <= staleTicks
      ? input
      : null;
  if (live) p.faceGoal = live.heading;
  if (isSeated(p)) {
    p.face = p.faceGoal = p.task!.spot.face;
    if (!live || Math.hypot(live.mx, live.mz) <= DEAD_ZONE) return 0;
    stand(p); // moving gets them out of the chair first
  }
  const mechanics = p.mechanics;
  if (!live) {
    // Release transient button state when packets stop arriving. Crouching is held,
    // while prone is a toggle; preserve the latter posture but allow the next edge.
    if (mechanics.posture === "crouching") {
      mechanics.posture = "standing";
      mechanics.crouchLevel = 0;
    }
    mechanics.proneHeld = false;
    mechanics.jumpHeld = false;
    // A lost input packet must not freeze a jump forever. Continue the
    // authoritative jump clock and land it even while the client is silent.
    if (mechanics.locomotion === "jump") {
      mechanics.verticalVelocity -= 9.8 * dt;
      p.pos.y = Math.max(0, p.pos.y + mechanics.verticalVelocity * dt);
      const sup = supportAt(p.pos.x / S + OX, p.pos.z / S + OY, p.pos.y || 0);
      if (
        (mechanics.verticalVelocity <= 0 && p.pos.y <= sup) ||
        tick >= mechanics.jumpUntil
      ) {
        p.pos.y = sup;
        mechanics.locomotion = "grid";
        mechanics.grounded = true;
        mechanics.verticalVelocity = 0;
      }
    }
    return 0;
  }
  // A ragdolled or recovering person cannot choose a posture: input must not cancel the fall or skip the recovery lockout.
  const downed =
    mechanics.posture === "ragdoll" ||
    mechanics.posture === "recovering" ||
    mechanics.locomotion === "ragdoll";
  if (!downed) {
    if (live.crouch) {
      mechanics.posture = "crouching";
      mechanics.crouchLevel = adjustCrouch(
        mechanics.crouchLevel,
        live.crouchWheel ?? 0,
      );
    } else if (mechanics.posture === "crouching") {
      // The wheel changes crouch depth while the key is held; releasing the key always stands,
      // even when the last wheel notch was not consumed by the server yet.
      mechanics.posture = "standing";
      mechanics.crouchLevel = 0;
    }
    if (live.prone && !mechanics.proneHeld)
      mechanics.posture = mechanics.posture === "prone" ? "standing" : "prone";
  }
  mechanics.proneHeld = live.prone === true;
  if (
    live.jump &&
    !mechanics.jumpHeld &&
    mechanics.grounded &&
    (mechanics.jumpUntil === 0 ||
      tick >=
        mechanics.jumpUntil + Math.ceil(JUMP.cooldown / Math.max(dt, 0.001))) &&
    canMove(mechanics) &&
    mechanics.posture !== "prone"
  ) {
    mechanics.locomotion = "jump";
    mechanics.grounded = false;
    mechanics.verticalVelocity = JUMP.velocity;
    mechanics.jumpUntil = tick + Math.ceil(JUMP.duration / Math.max(dt, 0.001));
  }
  mechanics.jumpHeld = live.jump === true;
  if (mechanics.locomotion === "jump") {
    mechanics.verticalVelocity -= 9.8 * dt;
    p.pos.y = Math.max(0, p.pos.y + mechanics.verticalVelocity * dt);
    // land on the surface under the feet (the floor, a desk top, a chair seat), coming down or when the hop clock runs out
    const sup = supportAt(p.pos.x / S + OX, p.pos.z / S + OY, p.pos.y || 0);
    if (
      (mechanics.verticalVelocity <= 0 && p.pos.y <= sup) ||
      tick >= mechanics.jumpUntil
    ) {
      p.pos.y = sup;
      mechanics.locomotion = "grid";
      mechanics.grounded = true;
      mechanics.verticalVelocity = 0;
    }
  }
  if (!canMove(mechanics)) return 0;
  const len = Math.hypot(live.mx, live.mz);
  if (len <= DEAD_ZONE) {
    p.face = p.faceGoal = live.heading;
    return 0;
  }
  const pace = carryPace(p.id);
  const speed =
    (live.run && pace.run ? RUN_SPEED : WALK_SPEED) *
    pace.factor *
    postureSpeedFactor(mechanics.posture, mechanics.crouchLevel) *
    Math.min(1, len) *
    dt;
  // in short steps, so a fast tick cannot jump over a thin wall
  const steps = Math.max(1, Math.ceil(speed / MAX_SUBSTEP));
  let moved = 0;
  for (let i = 0; i < steps; i++)
    moved += stepPlayer(
      p,
      ((live.mx / len) * speed) / steps,
      ((live.mz / len) * speed) / steps,
      others,
    );
  p.face = p.faceGoal = live.heading;
  p.walkPhase += moved * 4.6;
  // the surface under the feet: the floor or a furniture top. Walking off a ledge turns into a fall (same 'jump' state, no upward velocity)
  const sup = supportAt(p.pos.x / S + OX, p.pos.z / S + OY, p.pos.y || 0);
  if (mechanics.locomotion === "jump") {
    if (mechanics.verticalVelocity <= 0 && p.pos.y <= sup + 1e-4) {
      p.pos.y = sup;
      mechanics.locomotion = "grid";
      mechanics.grounded = true;
      mechanics.verticalVelocity = 0;
    } else if (p.pos.y < sup) {
      p.pos.y = sup;
    }
  } else if (mechanics.grounded) {
    if (p.pos.y > sup + 1e-6) {
      mechanics.grounded = false;
      mechanics.locomotion = "jump";
      mechanics.verticalVelocity = 0;
      mechanics.jumpUntil = tick + Math.ceil(10 / Math.max(dt, 0.001));
    } else p.pos.y = sup;
  }
  return moved;
}

/** Everyone a human is driving gets one tick of movement, from the inputs `inputs` holds for them (keyed by person id). */
export function stepAllDriven(
  inputs: ReadonlyMap<number, DrivenInput>,
  dt: number,
  tick: number,
): void {
  const staleTicks = Math.max(2, Math.ceil(INPUT_STALE_SECONDS / dt)); // a quarter of a second, whatever the tick rate
  for (const p of people) {
    // a task (a Power Slap) can take over a human's person: the sim drives them then, not their inputs
    if (
      p.controller !== "account" ||
      p.state !== "controlled" ||
      characterHolds.getHolder(p.id)
    )
      continue;
    stepDriven(p, inputs.get(p.id) ?? null, dt, tick, people, staleTicks);
  }
}
