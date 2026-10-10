import { shapeOf, type Collider } from './catalogue';
import type { Hold, Quat, WorldObject } from './objects';

// A person's arms: how far they reach and how much they can hold out in front of them, and where on an item a hand can take it. Plain maths
// on the item's own shapes, so the page (to say "step closer") and the server (to decide) agree. See docs/ITEMS-PHYSICS-PLAN.md, section 6.

export type Point = { x: number; y: number; z: number };

export const ARMS = {
  /** Shoulder to grip, in metres. */
  length: .6,
  /** Height of the shoulders above the floor. */
  shoulderY: 1.35,
  /** How far from the middle of the body a hand reaches, seen from above: the arm, the shoulder's width and a little lean. */
  reach: .85,
  /** The lowest and highest a hand can take something (bending down to the floor, reaching up). */
  lowest: 0,
  highest: 2.1,
  /** How far off the item a grip point may be and still count as on it (the page's aim is not exact). */
  slack: .06,
} as const;

/**
 * How much a person can hold out in front of them, as a torque about the shoulders in newton metres: holding mass m at d metres out takes
 * m·g·d. One hand, and both. (A 12 kg chair held two-handed can be at most about half a metre out; anything over 35 kg not lifted at all.)
 */
export const STRENGTH = { oneHand: 15, twoHands: 60 } as const;

const rotate = (q: Quat, v: Point): Point => {
  const [qx, qy, qz, qw] = q, { x, y, z } = v;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return { x: ix * qw + iw * -qx + iy * -qz - iz * -qy, y: iy * qw + iw * -qy + iz * -qx - ix * -qz, z: iz * qw + iw * -qz + ix * -qy - iy * -qx };
};
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** Two orientations one after the other: `b`, then turned by `a`. */
export const mulQuat = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const eulerQ = ([x, y, z]: readonly number[]): Quat => {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
};
/** The orientation of an item now: its tilt if it has one, else upright facing `rot`. */
export const orientationOf = (o: WorldObject): Quat => o.q ?? [0, Math.sin(o.rot / 2), 0, Math.cos(o.rot / 2)];

/** A world point in the item's own frame (its origin, facing rotation 0). */
export function toItemFrame(o: WorldObject, p: Point): Point {
  return rotate(conj(orientationOf(o)), { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z });
}
/** A point in the item's own frame, in the world. */
export function fromItemFrame(o: WorldObject, p: Point): Point {
  const w = rotate(orientationOf(o), p);
  return { x: o.x + w.x, y: o.y + w.y, z: o.z + w.z };
}

/** The closest point on one shape to `p`, both in the item's frame. */
function closestOnCollider(c: Collider, p: Point): Point {
  const q = c.rot && c.shape !== 'sphere' ? eulerQ(c.rot) : null;
  let l = { x: p.x - c.at[0], y: p.y - c.at[1], z: p.z - c.at[2] };
  if (q) l = rotate(conj(q), l);
  let out: Point;
  if (c.shape === 'box') {
    const [hx, hy, hz] = c.size.map(s => s / 2);
    out = { x: Math.max(-hx, Math.min(hx, l.x)), y: Math.max(-hy, Math.min(hy, l.y)), z: Math.max(-hz, Math.min(hz, l.z)) };
  } else if (c.shape === 'cylinder') {
    const d = Math.hypot(l.x, l.z), k = d > c.radius ? c.radius / d : 1;
    out = { x: l.x * k, y: Math.max(-c.height / 2, Math.min(c.height / 2, l.y)), z: l.z * k };
  } else {
    const d = Math.hypot(l.x, l.y, l.z), k = d > c.radius ? c.radius / d : 1;
    out = { x: l.x * k, y: l.y * k, z: l.z * k };
  }
  if (q) out = rotate(q, out);
  return { x: out.x + c.at[0], y: out.y + c.at[1], z: out.z + c.at[2] };
}

/** The point of the item nearest to `p` (in the world): on its surface, or `p` itself when `p` is inside it. */
export function closestPointOnItem(o: WorldObject, p: Point): Point {
  const local = toItemFrame(o, p);
  let best: Point | null = null, bd = Infinity;
  for (const c of shapeOf(o).colliders) {
    const q = closestOnCollider(c, local), d = Math.hypot(q.x - local.x, q.y - local.y, q.z - local.z);
    if (d < bd) { bd = d; best = q; }
  }
  return fromItemFrame(o, best ?? { x: 0, y: 0, z: 0 });
}

/** Can this person's hand get to this point from where they stand? */
export const canReach = (person: { pos: { x: number; z: number } }, p: Point): boolean =>
  Math.hypot(p.x - person.pos.x, p.z - person.pos.z) <= ARMS.reach && p.y >= ARMS.lowest - .01 && p.y <= ARMS.highest;

/** Is this point on the item (within the slack an aim needs)? */
export const onItem = (o: WorldObject, p: Point): boolean => {
  const q = closestPointOnItem(o, p);
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= ARMS.slack;
};

/**
 * A hold that keeps the item as it is to this person now: their hands where they took it (`at`, in the item's frame), in the direction it is
 * from them (`az`), and its angle to them as it is (`rel`). Things close in front of the chest count as straight in front.
 */
export function holdFor(o: WorldObject, person: { id: number; face: number; pos: { x: number; z: number } }, point: Point): Hold {
  const half = person.face / 2, dx = point.x - person.pos.x, dz = point.z - person.pos.z, out = Math.hypot(dx, dz);
  const az = out < .15 ? 0 : Math.atan2(Math.sin(Math.atan2(dx, dz) - person.face), Math.cos(Math.atan2(dx, dz) - person.face));
  return { person: person.id, at: toItemFrame(o, point), rel: mulQuat([0, -Math.sin(half), 0, Math.cos(half)], orientationOf(o)), turn: [0, 0, 0, 1], lift: point.y, out, az, raise: 0 };
}

/** Where a person takes an item when they did not say: the point of it nearest their chest. */
export const nearestGrip = (o: WorldObject, person: { pos: { x: number; z: number } }): Point =>
  closestPointOnItem(o, { x: person.pos.x, y: 1.0, z: person.pos.z });
