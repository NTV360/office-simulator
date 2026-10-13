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
  /** How far each shoulder is from the middle of the body, sideways (m). */
  shoulderX: .2,
  /** How much shorter or longer than its own length an arm is drawn, at the least and the most, to put a hand on its grip. */
  stretchMin: .6,
  stretchMax: 1.7,
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

// ---- where a hand can take hold
// A hand does not take hold of the middle of a flat face (nobody carries a TV by its screen or its back panel): it takes hold of an edge, a
// rim, a rail, a pole. So every item has grip spots: along the edges of its boxes, round the rims and sides of its cylinders, over its
// spheres. They come from the item's own shapes, so every kind has them without anybody listing them. A grab snaps to them.

const gripCache = new Map<string, Point[]>();
/** The places a hand can take hold of this kind of item, in its own frame. */
function gripSpotsLocal(o: WorldObject): Point[] {
  const key = o.type + (o.dims ? ':' + o.dims.join(',') : '');
  let out = gripCache.get(key);
  if (out) return out;
  out = [];
  for (const c of shapeOf(o).colliders) {
    const q = c.rot && c.shape !== 'sphere' ? eulerQ(c.rot) : null;
    const put = (x: number, y: number, z: number) => {
      const r = q ? rotate(q, { x, y, z }) : { x, y, z };
      out!.push({ x: r.x + c.at[0], y: r.y + c.at[1], z: r.z + c.at[2] });
    };
    if (c.shape === 'box') {
      const h = c.size.map(v => v / 2);
      for (let axis = 0; axis < 3; axis++) {
        const [a, b] = [0, 1, 2].filter(i => i !== axis);
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) for (const t of [-.8, -.5, -.25, 0, .25, .5, .8]) {
          const p: number[] = [0, 0, 0];
          p[axis] = t * h[axis]; p[a] = sa * h[a]; p[b] = sb * h[b];
          put(p[0], p[1], p[2]);
        }
      }
    } else if (c.shape === 'cylinder') {
      const h = c.height / 2;
      for (const y of [-h, -.35 * h, .35 * h, h]) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; put(Math.cos(a) * c.radius, y, Math.sin(a) * c.radius); }
    } else {
      const r = c.radius, d = r / Math.sqrt(3);
      for (const v of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) put(v[0], v[1], v[2]);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) put(sx * d, sy * d, sz * d);
    }
  }
  gripCache.set(key, out);
  return out;
}
/** The places a hand can take hold of this item now, in the world. */
export const gripSpots = (o: WorldObject): Point[] => gripSpotsLocal(o).map(p => fromItemFrame(o, p));

/** Where the hands go: one on each side for something two-handed (`left` is the person's left), one for a one-hand thing, and the point between them. */
export interface Grips { left: Point | null; right: Point; mid: Point }

/**
 * Where a person takes hold of an item when they aim at `aim` (a point on it). A one-hand thing is taken at the one grip spot nearest the
 * aim. For two hands the best PAIR of grip spots is chosen: along the item's long side (the person's left hand on their left), a sensible
 * way apart (up to 60 cm, less for something narrow), about level with each other, and near where the aim is. A big flat thing such as a TV
 * ends up held by its bottom rim, not by its face.
 */
export function gripPair(o: WorldObject, person: { pos: { x: number; z: number } }, aim: Point, one: boolean): Grips {
  const spots = gripSpots(o);
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const nearest = (to: Point): Point => spots.reduce((best, g) => (dist(g, to) < dist(best, to) ? g : best), spots[0]);
  if (one || spots.length < 2) { const g = nearest(aim); return { left: null, right: g, mid: g }; }

  // the side of the item the hands spread along: whichever of its two horizontal sides runs across the person's view (so the left hand is on
  // their left), counting how far it extends; if neither does (they look along it) the longer one
  const lo = gripSpotsLocal(o);
  let ex = 0, ez = 0;
  for (const g of lo) { ex = Math.max(ex, Math.abs(g.x)); ez = Math.max(ez, Math.abs(g.z)); }
  const origin = fromItemFrame(o, { x: 0, y: 0, z: 0 });
  const yaw = Math.atan2(aim.x - person.pos.x, aim.z - person.pos.z), lx = Math.cos(yaw), lz = -Math.sin(yaw); // (their left)
  const dir = (p: Point) => { const dx = p.x - origin.x, dz = p.z - origin.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const [x1, z1] = dir(fromItemFrame(o, { x: 1, y: 0, z: 0 })), [x2, z2] = dir(fromItemFrame(o, { x: 0, y: 0, z: 1 }));
  const use1 = ex * Math.abs(x1 * lx + z1 * lz), use2 = ez * Math.abs(x2 * lx + z2 * lz);
  const first = Math.max(use1, use2) < .1 ? ex >= ez : use1 >= use2;
  let ax = first ? x1 : x2, az = first ? z1 : z2;
  if (ax * lx + az * lz < 0) { ax = -ax; az = -az; } // (now ax, az points to their left)
  const longSide = first ? ex : ez, apart = Math.min(.6, longSide * 2 * .7), half = apart / 2, y = Math.max(.7, Math.min(1.3, aim.y));
  const wantL = { x: aim.x + ax * half, y, z: aim.z + az * half }, wantR = { x: aim.x - ax * half, y, z: aim.z - az * half };

  // the best pair among the spots near the aim: close to where each hand wants to be, level, and not on top of each other
  const near = spots.filter(g => dist(g, aim) < 1.1);
  let best: [Point, Point] | null = null, bs = Infinity;
  for (const l of near) for (const r of near) {
    // (each hand on its own side: the one on the left has to be further to the left)
    if ((l.x - r.x) * ax + (l.z - r.z) * az < apart * .6) continue;
    const score = dist(l, wantL) + dist(r, wantR) + .6 * Math.abs(l.y - r.y);
    if (score < bs) { bs = score; best = [l, r]; }
  }
  if (!best) { const l = nearest(wantL); let r = nearest(wantR); if (dist(l, r) < .05) r = spots.filter(g => dist(g, l) > .05).reduce((b2, g) => (dist(g, wantR) < dist(b2, wantR) ? g : b2), spots[0]); best = [l, r]; }
  const [left, right] = best;
  return { left, right, mid: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 } };
}

// ---- keeping a good grip as the item is turned and raised
// The hands are on two grip spots of the item, so when the item is turned in the hands they go where the spots go: turn a chair right over
// and the left spot is on the person's right and the arms point behind them. Nobody holds it like that; they let go with one hand and take it
// again somewhere else. `regripPair` is that: it keeps the grip while it is still a sensible way to hold the thing, and finds a better pair of
// spots when it is not (the arms cannot reach it, or the hands have crossed).

/** A grip in the item's own frame: where each hand is on the item, wherever the item goes. */
export interface GripsLocal { left: Point | null; right: Point }
/** A grip (in the world) as it is on the item now, in its own frame. */
export const gripsToLocal = (o: WorldObject, g: Grips): GripsLocal => ({ left: g.left && toItemFrame(o, g.left), right: toItemFrame(o, g.right) });

/** The two shoulders of a person in the world (their left and right). */
export function shoulders(person: { pos: { x: number; z: number }; face: number }): { left: Point; right: Point } {
  const lx = Math.cos(person.face) * ARMS.shoulderX, lz = -Math.sin(person.face) * ARMS.shoulderX;
  return { left: { x: person.pos.x + lx, y: ARMS.shoulderY, z: person.pos.z + lz }, right: { x: person.pos.x - lx, y: ARMS.shoulderY, z: person.pos.z - lz } };
}

/** The furthest and nearest a hand may be from its own shoulder: an arm stretched or shortened as far as it is drawn, in metres. */
const REACH = { least: .12, most: ARMS.length * ARMS.stretchMax };

/**
 * `held` is the grip they have now, in the item's own frame (so it goes where the item goes: see `gripsToLocal`). Returns it again, in the
 * world, while it is a sensible way to hold the item; else a better one: spots each hand can reach, the left hand on the left, level, a sensible
 * way apart, close to where the hands rest and to the old grip.
 */
export function regripPair(o: WorldObject, person: { pos: { x: number; z: number }; face: number }, one: boolean, held: GripsLocal | null): Grips {
  const prev: Grips | null = held && { left: held.left && fromItemFrame(o, held.left), right: fromItemFrame(o, held.right), mid: fromItemFrame(o, held.right) };
  if (prev && prev.left) prev.mid = { x: (prev.left.x + prev.right.x) / 2, y: (prev.left.y + prev.right.y) / 2, z: (prev.left.z + prev.right.z) / 2 };
  const sh = shoulders(person), lat = { x: Math.cos(person.face), z: -Math.sin(person.face) };
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const reaches = (g: Point, s: Point) => { const d = dist(g, s); return d >= REACH.least && d <= REACH.most && g.y >= ARMS.lowest - .05 && g.y <= ARMS.highest + .2; };
  const across = (l: Point, r: Point) => (l.x - r.x) * lat.x + (l.z - r.z) * lat.z; // (how far to the left of the right hand the left one is)
  if (prev) {
    const fine = one ? reaches(prev.right, sh.right) : !!prev.left && reaches(prev.left, sh.left) && reaches(prev.right, sh.right) && across(prev.left, prev.right) > .08;
    if (fine) return prev;
  }
  const spots = gripSpots(o);
  if (one || spots.length < 2) {
    let best = prev?.right ?? spots[0], bs = Infinity;
    for (const g of spots) { if (!reaches(g, sh.right)) continue; const sc = dist(g, sh.right) + (prev ? .8 * dist(g, prev.right) : 0); if (sc < bs) { bs = sc; best = g; } }
    return { left: null, right: best, mid: best };
  }
  const lefts = spots.filter(g => reaches(g, sh.left)), rights = spots.filter(g => reaches(g, sh.right));
  let best: [Point, Point] | null = null, bs = Infinity;
  for (const l of lefts) for (const r of rights) {
    const apart = across(l, r), spread = dist(l, r);
    if (apart < .15) continue; // (the left hand on the left, clear of the right)
    const score = dist(l, sh.left) + dist(r, sh.right) + .6 * Math.abs(l.y - r.y)
      + (spread > .7 ? (spread - .7) * 3 : 0) + (spread < .25 ? (.25 - spread) * 3 : 0)
      + (prev && prev.left ? .8 * (dist(l, prev.left) + dist(r, prev.right)) : 0);
    if (score < bs) { bs = score; best = [l, r]; }
  }
  if (!best) return prev ?? gripPair(o, person, fromItemFrame(o, { x: 0, y: 0, z: 0 }), false); // (nothing reachable now: keep what they have)
  const [left, right] = best;
  return { left, right, mid: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 } };
}
