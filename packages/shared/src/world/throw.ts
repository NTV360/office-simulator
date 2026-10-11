import { CATALOGUE, shapeOf } from './catalogue';
import type { WorldObject } from './objects';

// Throwing, the same on the server (which does it) and the page (which draws where it will go). A throw puts energy into what is thrown, up
// to what a person heaving with their whole body manages, and nothing leaves the hand faster than an arm swings: a mug flies far and fast, a
// chair goes in a lob a few tables away. It goes the way the thrower looks, a little above that: look up to lob it in an arc, look level to
// throw it straight. The air pushes back on fast things (½ ρ Cd A v²). See docs/ITEMS-PHYSICS-PLAN.md, section 9.

/**
 * `energy`: the most a full throw puts in (J; about a strong two-handed heave: a 6 kg chair leaves at 7 m/s and lands 5 to 7 m away);
 * `least`: what even a flick puts in (J); `fastest`: the fastest anything leaves the hand (m/s, a hard overarm throw); `lift`: how far above
 * where they look it goes (rad); `low`, `high`: the flattest and steepest it can be thrown (rad).
 */
export const THROW = { energy: 160, least: 6, fastest: 18, lift: .12, low: -.6, high: 1.3 } as const;
/** Air density (kg/m³). */
export const AIR = 1.2;
/** Gravity (m/s²). */
export const G = 9.81;
/** Below this speed (m/s) the air does nothing anyone would see. */
export const DRAG_FROM = 2;

export interface Velocity { vx: number; vy: number; vz: number }

/** How fast what is thrown leaves the hand, thrown as hard as `power` (0 to 1) says, toward `yaw` and `pitch` (where the thrower looks). */
export function throwVelocity(o: WorldObject, power: number, yaw: number, pitch: number): Velocity {
  const p = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
  const speed = Math.min(THROW.fastest, Math.sqrt(2 * (THROW.least + THROW.energy * p) / CATALOGUE[o.type].mass));
  const up = Math.max(THROW.low, Math.min(THROW.high, (Number.isFinite(pitch) ? pitch : 0) + THROW.lift)), c = Math.cos(up);
  const a = Number.isFinite(yaw) ? yaw : 0;
  return { vx: Math.sin(a) * c * speed, vy: Math.sin(up) * speed, vz: Math.cos(a) * c * speed };
}

const areas = new Map<string, number>();
/** The area an item shows the air, about: the mean face of the box round its shapes (m²). */
export function airArea(o: WorldObject): number {
  const key = o.type + (o.dims ? ':' + o.dims.join(',') : '');
  let a = areas.get(key);
  if (a === undefined) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of shapeOf(o).colliders) {
      const half = c.shape === 'box' ? c.size.map(s => s / 2) : c.shape === 'cylinder' ? [c.radius, c.height / 2, c.radius] : [c.radius, c.radius, c.radius];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c.at[i] - half[i]); hi[i] = Math.max(hi[i], c.at[i] + half[i]); }
    }
    const [x, y, z] = [0, 1, 2].map(i => hi[i] - lo[i]);
    a = (x * y + y * z + x * z) / 3;
    areas.set(key, a);
  }
  return a;
}
/** The air's push on it, divided by its speed squared (N per (m/s)²): ½ ρ Cd A, paper a little more. */
export const dragOf = (o: WorldObject): number => .5 * AIR * (CATALOGUE[o.type].material === 'paper' ? 1.3 : 1.0) * airArea(o);

/**
 * Where something thrown from `from` at `v` goes, in steps of `step` seconds, for at most `most` seconds, until `stop` says it has hit
 * something (given the last point and the next) or it is below the floor. The points, the first being `from`.
 */
export function throwPath(o: WorldObject, from: { x: number; y: number; z: number }, v: Velocity, stop?: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => boolean, step = 1 / 30, most = 3): Array<{ x: number; y: number; z: number }> {
  const m = CATALOGUE[o.type].mass, k = dragOf(o), out = [{ ...from }];
  let { x, y, z } = from, { vx, vy, vz } = v;
  for (let t = 0; t < most; t += step) {
    const speed = Math.hypot(vx, vy, vz), d = speed >= DRAG_FROM ? k * speed / m : 0;
    vx -= d * vx * step; vy -= (d * vy + G) * step; vz -= d * vz * step;
    const next = { x: x + vx * step, y: y + vy * step, z: z + vz * step };
    if (next.y <= 0) { const f = y / (y - next.y); out.push({ x: x + (next.x - x) * f, y: 0, z: z + (next.z - z) * f }); break; }
    if (stop && stop({ x, y, z }, next)) break;
    out.push(next); ({ x, y, z } = next);
  }
  return out;
}
