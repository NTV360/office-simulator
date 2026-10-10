import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARMS, CATALOGUE, STRENGTH, carryOf, holdFor, letGo, mulQuat, nearestGrip, objects, people, setObjectPose, setPlacer, shapeOf, simEvents,
  type Hold, type Placing, type Quat, type WorldObject,
} from '@office/shared';
import { Physics, SUBSTEP, GRAVITY, yawQuat, type StaticShape } from './physics';

// Keeps the items and their bodies in step, both ways, and holds what people hold. When the game moves an item (put back, restored), its
// body follows; when physics moves a body (it fell, slid, is carried), the item follows, and the usual `objectMoved` tells every player.
// A held item stays a body: each hand pulls the point it took hold of towards where the hand is, with a spring that also carries its
// share of the weight, as hard as that person's arms allow; the item keeps the angle it was taken at. See docs/ITEMS-PHYSICS-PLAN.md, 6.

/** Below these an item has not moved, as far as anyone is told: physics settles in fractions of a millimetre. */
const MOVE_EPS = .001, TURN_EPS = .5 * Math.PI / 180;
/**
 * An item this close to upright is written as upright (`q` null). One that comes to rest this close to its starting place (2 cm, a degree and
 * a half: nudged by something carried past) is put exactly back there, so it is not "moved" for ever by a bump nobody would see.
 */
const UPRIGHT = .5 * Math.PI / 180, HOME_EPS = .02, HOME_TURN = 1.5 * Math.PI / 180;
/** Put down this much above its surface, so it starts clear of it and settles onto it. */
const LIFT = .002;

/** How a hand holds: its spring's stiffness and the turn's (rad/s: about 2 and 1.6 a second), how far a hand goes before it slips off (m). */
const HAND = { stiff: 12, turn: 10, slip: .6 } as const;
/** Where things are carried: hands this high, this far in front (m), reached from where they were taken in about a second (gently: a mug on a chair stays on). */
const CARRY = { y: 1.0, out: { oneHand: .38, twoHands: .45 }, ease: 1.2, clear: .25, highest: 1.5 } as const;
/** The most a person pulls or pushes something along, sideways to their reach (N): one hand, both. */
const PULL = { oneHand: 120, twoHands: 450 } as const;
/** A thing being put down: it is let go when within this of its place, or after this long whatever happens (s). */
const PLACE = { near: .02, turn: 3 * Math.PI / 180, give: 2, stiff: 9 } as const;
/** The air's density (kg/m³). */
const AIR = 1.2;

/** How far an orientation is turned away from upright, in radians. */
const tiltOf = (q: readonly number[]): number => 2 * Math.asin(Math.min(1, Math.hypot(q[0], q[2])));
/** The way an orientation faces: where it turns the item's own forward (+z), seen from above (the page's rotation.y convention). */
function yawOf(q: readonly number[]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** The angle between two orientations, in radians. */
const between = (a: readonly number[], b: readonly number[]) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const isHome = (x: number, y: number, z: number, rot: number, o: WorldObject) => x === o.home.x && y === o.home.y && z === o.home.z && rot === o.home.rot;
type V = { x: number; y: number; z: number };
function rotate(q: Quat, v: V): V {
  const [qx, qy, qz, qw] = q, tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
  return { x: v.x + qw * tx + (qy * tz - qz * ty), y: v.y + qw * ty + (qz * tx - qx * tz), z: v.z + qw * tz + (qx * ty - qy * tx) };
}
/** The turn that takes orientation `from` to `to`, as a rotation vector (axis times angle), the short way round. */
function turnBetween(from: Quat, to: Quat): V {
  let [x, y, z, w] = mulQuat(to, [-from[0], -from[1], -from[2], from[3]]);
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return { x: 0, y: 0, z: 0 };
  const a = 2 * Math.atan2(s, w) / s;
  return { x: x * a, y: y * a, z: z * a };
}

export class ItemPhysics {
  readonly physics: Physics;
  private awakeBefore = new Set<number>();
  private writing = false;
  private readonly stop: () => void;

  /** Bodies for every item the world has now, where it is. `loadPhysics()` must have finished. */
  constructor(shapes: readonly StaticShape[]) {
    this.physics = new Physics(shapes);
    for (const o of objects.all()) this.physics.addItem(o, o.q ?? yawQuat(o.rot));
    this.stop = simEvents.on('objectMoved', o => this.follow(o));
    setPlacer((o, p) => { o.placing = p; this.physics.setPassThrough(o, true); this.physics.body(o.index)?.wakeUp(); });
  }

  /** The game moved an item: its body goes there too. (One somebody holds is moved by their hands; one just let go keeps moving as it was.) */
  private follow(o: WorldObject): void {
    if (this.writing) return; // (physics moved it: the body is already there)
    if (o.carriedBy !== null) { this.physics.setBig(o, true); this.physics.body(o.index)?.wakeUp(); return; }
    this.physics.setBig(o, false);
    this.physics.setPassThrough(o, false); // (down: it touches everything again)
    if (o.released) {
      const b = this.physics.body(o.index), v = o.released;
      o.released = undefined;
      if (b) { const w = b.linvel(); b.setLinvel({ x: w.x + v.vx, y: w.y + v.vy, z: w.z + v.vz }, true); }
      return;
    }
    this.physics.place(o.index, { x: o.x, y: o.y + LIFT, z: o.z, q: o.q ?? yawQuat(o.rot) });
  }

  /** Advance the physics by `dt` seconds (the hands pushing on what they hold before every substep), and move every item whose body moved. */
  step(dt: number): void {
    const held = objects.all().filter(o => o.carriedBy !== null);
    for (const o of held) { this.ensureHold(o); this.ease(o, dt); }
    const flying = this.physics.awake().map(i => objects.at(i)).filter((o): o is WorldObject => !!o && o.carriedBy === null);
    this.physics.step(dt, () => {
      for (const o of held) if (o.carriedBy !== null) this.push(o);
      for (const o of flying) this.air(o);
    });
    const awake = new Set(this.physics.awake());
    for (const i of awake) this.read(i, false);
    for (const i of this.awakeBefore) if (!awake.has(i)) this.read(i, true); // (it has just come to rest: its final pose, tidied)
    this.awakeBefore = awake;
    for (const o of held) this.check(o, dt);
  }

  /** Something marked carried with no hold said (put in somebody's hands by a test or a restore): they hold it by the point nearest them. */
  private ensureHold(o: WorldObject): void {
    if (o.holds.length) return;
    const p = people.find(q => q.id === o.carriedBy);
    if (!p) return;
    o.holds = [holdFor(o, p, nearestGrip(o, p))];
  }

  /** The hands go from where they took it to where things are carried, and up or down as the person asks. Once a tick. */
  private ease(o: WorldObject, dt: number): void {
    const one = carryOf(o.type) === 'one-hand', k = Math.min(1, dt * CARRY.ease);
    // (a heavy thing is held close, as far out as the arms comfortably bear its share: a TV hugged, a chair at arm's length)
    const share = CATALOGUE[o.type].mass / Math.max(1, o.holds.length) * GRAVITY;
    const out = Math.max(.2, Math.min(one ? CARRY.out.oneHand : CARRY.out.twoHands, .9 * (one ? STRENGTH.oneHand : STRENGTH.twoHands) / share));
    for (const h of o.holds) {
      // (hands high enough for it to clear the floor: a chair held by the top of its back is carried higher than a mug)
      const lift = Math.max(ARMS.lowest + .1, Math.min(ARMS.highest - .2, Math.min(CARRY.highest, Math.max(CARRY.y, h.at.y + CARRY.clear)) + h.raise));
      // (up first, then in: a chair tucked in at a table is lifted clear before it is drawn towards you, not dragged through the table)
      if (h.lift > lift - .2) h.out += (out - h.out) * k;
      h.lift += (lift - h.lift) * k;
    }
  }

  /** Where a hand is now: out from the person in the direction the thing was when they took it (turning with them), as far and as high as their hold says. */
  private handOf(h: Hold): V | null {
    const p = people.find(q => q.id === h.person);
    if (!p) return null;
    const a = p.face + h.az;
    return { x: p.pos.x + Math.sin(a) * h.out, y: h.lift, z: p.pos.z + Math.cos(a) * h.out };
  }

  /** Every hand on this item pushes on it, for one substep (and a thing being put down is lowered to its place). */
  private push(o: WorldObject): void {
    const b = this.physics.body(o.index);
    if (!b) return;
    b.wakeUp();
    const m = CATALOGUE[o.type].mass, t = b.translation(), r = b.rotation(), q: Quat = [r.x, r.y, r.z, r.w];
    const v = b.linvel(), w = b.angvel();
    if (o.placing) { this.lower(b, o.placing, m, q); return; }
    const one = carryOf(o.type) === 'one-hand', n = o.holds.length || 1;
    for (const h of o.holds) {
      const hand = this.handOf(h), p = people.find(x => x.id === h.person);
      if (!hand || !p) continue;
      const g0 = rotate(q, h.at), g = { x: t.x + g0.x, y: t.y + g0.y, z: t.z + g0.z };
      const gv = { x: v.x + w.y * g0.z - w.z * g0.y, y: v.y + w.z * g0.x - w.x * g0.z, z: v.z + w.x * g0.y - w.y * g0.x };
      const share = m / n, k = HAND.stiff * HAND.stiff, c = 2 * HAND.stiff;
      const f = { x: share * (k * (hand.x - g.x) - c * gv.x), y: share * (k * (hand.y - g.y) - c * gv.y), z: share * (k * (hand.z - g.z) - c * gv.z) };
      // the arms hold up what they can at that distance from the shoulders (m·g·d against their strength), and pull what they can along
      const d = Math.max(.2, Math.hypot(g.x - p.pos.x, g.z - p.pos.z));
      const up = (one ? STRENGTH.oneHand : STRENGTH.twoHands) / d, total = Math.max(-up, Math.min(up, f.y + share * GRAVITY));
      // (its weight is borne through its middle: lifted by a corner it does not hang off that corner, the wrists keep it level; the rest of
      // the spring acts at the grip)
      const bear = Math.min(share * GRAVITY, Math.max(0, total));
      f.y = total - bear;
      const side = Math.hypot(f.x, f.z), most = one ? PULL.oneHand : PULL.twoHands;
      if (side > most) { f.x *= most / side; f.z *= most / side; }
      b.applyImpulse({ x: 0, y: bear * SUBSTEP, z: 0 }, true);
      b.applyImpulseAtPoint({ x: f.x * SUBSTEP, y: f.y * SUBSTEP, z: f.z * SUBSTEP }, g, true);
    }
    // one person holding it keeps it at the angle they took it, turned as they turn it (several: the hands alone decide its angle)
    if (o.holds.length === 1) {
      const h = o.holds[0], p = people.find(x => x.id === h.person);
      if (!p) return;
      const target = mulQuat(mulQuat(yawQuat(p.face), h.turn), h.rel);
      this.steer(b, q, target, HAND.turn, (one ? STRENGTH.oneHand : STRENGTH.twoHands) * 1.5);
    }
  }

  /**
   * Turn a body towards an orientation with a critically damped spring, no harder than `most` newton metres. The torque is the body's own
   * inertia (as the engine has it, in the world's axes) times the turn wanted: with a guessed inertia the damping overshoots and it shakes.
   */
  private steer(b: RAPIER.RigidBody, q: Quat, target: Quat, rate: number, most: number): void {
    const e = turnBetween(q, target), w = b.angvel(), I = b.effectiveAngularInertia();
    const a = { x: rate * rate * e.x - 2 * rate * w.x, y: rate * rate * e.y - 2 * rate * w.y, z: rate * rate * e.z - 2 * rate * w.z };
    const tq = { x: I.m11 * a.x + I.m12 * a.y + I.m13 * a.z, y: I.m21 * a.x + I.m22 * a.y + I.m23 * a.z, z: I.m31 * a.x + I.m32 * a.y + I.m33 * a.z };
    const size = Math.hypot(tq.x, tq.y, tq.z);
    if (size > most) { tq.x *= most / size; tq.y *= most / size; tq.z *= most / size; }
    b.applyTorqueImpulse({ x: tq.x * SUBSTEP, y: tq.y * SUBSTEP, z: tq.z * SUBSTEP }, true);
  }

  /** A thing being put down: its own origin is brought, gently and upright, to the place. */
  private lower(b: RAPIER.RigidBody, at: Placing, m: number, q: Quat): void {
    const t = b.translation(), v = b.linvel(), k = PLACE.stiff * PLACE.stiff, c = 2 * PLACE.stiff;
    // (carried across first and lowered last: held above the place by as much as it still has to go, so it is not dragged over the floor)
    const over = Math.min(.15, Math.hypot(at.x - t.x, at.z - t.z));
    const f = { x: m * (k * (at.x - t.x) - c * v.x), y: m * (k * (at.y + LIFT + over - t.y) - c * v.y + GRAVITY), z: m * (k * (at.z - t.z) - c * v.z) };
    b.applyImpulse({ x: f.x * SUBSTEP, y: f.y * SUBSTEP, z: f.z * SUBSTEP }, true);
    this.steer(b, q, yawQuat(at.rot), PLACE.stiff, Infinity);
  }

  /**
   * Air pushes back on what flies through it: ½ ρ Cd A v², against the way it goes. A thrown mug hardly notices; a notebook does. (Only fast
   * things: below 2 m/s the air does nothing anyone would see.)
   */
  private air(o: WorldObject): void {
    const b = this.physics.body(o.index);
    if (!b) return;
    const v = b.linvel(), speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 2) return;
    const k = .5 * AIR * (CATALOGUE[o.type].material === 'paper' ? 1.3 : 1.0) * this.areaOf(o) * speed;
    b.applyImpulse({ x: -k * v.x * SUBSTEP, y: -k * v.y * SUBSTEP, z: -k * v.z * SUBSTEP }, true);
  }
  private readonly areas = new Map<string, number>();
  /** The area an item shows the air, about: the mean face of the box round its shapes (m²). */
  private areaOf(o: WorldObject): number {
    const key = o.type + (o.dims ? ':' + o.dims.join(',') : '');
    let a = this.areas.get(key);
    if (a === undefined) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const c of shapeOf(o).colliders) {
        const half = c.shape === 'box' ? c.size.map(s => s / 2) : c.shape === 'cylinder' ? [c.radius, c.height / 2, c.radius] : [c.radius, c.radius, c.radius];
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c.at[i] - half[i]); hi[i] = Math.max(hi[i], c.at[i] + half[i]); }
      }
      const [x, y, z] = [0, 1, 2].map(i => hi[i] - lo[i]);
      a = (x * y + y * z + x * z) / 3;
      this.areas.set(key, a);
    }
    return a;
  }

  /** After a tick: a hand pulled too far from its grip slips off; a thing put down that has got there (or taken too long) is let go. */
  private check(o: WorldObject, dt: number): void {
    if (o.carriedBy === null) return;
    const b = this.physics.body(o.index);
    if (!b) return;
    const t = b.translation(), r = b.rotation(), q: Quat = [r.x, r.y, r.z, r.w];
    if (o.placing) {
      o.placing.t += dt;
      const there = Math.hypot(t.x - o.placing.x, t.y - o.placing.y - LIFT, t.z - o.placing.z) < PLACE.near && between(q, yawQuat(o.placing.rot)) < PLACE.turn;
      if (there || o.placing.t > PLACE.give) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); letGo(o); }
      return;
    }
    const kept = o.holds.filter(h => {
      const hand = this.handOf(h);
      if (!hand) return false;
      const g0 = rotate(q, h.at);
      return Math.hypot(hand.x - t.x - g0.x, hand.y - t.y - g0.y, hand.z - t.z - g0.z) <= HAND.slip;
    });
    if (kept.length === o.holds.length) return;
    if (!kept.length) { letGo(o); return; }
    o.holds = kept; o.carriedBy = kept[0].person;
    simEvents.emit('objectMoved', o);
  }

  private read(index: number, settled: boolean): void {
    const o = objects.at(index), p = this.physics.pose(index);
    if (!o || !p) return;
    let q: Quat | null = tiltOf(p.q) < UPRIGHT ? null : p.q;
    let { x, y, z } = p, rot = yawOf(p.q);
    if (settled && !q && o.carriedBy === null && Math.hypot(x - o.home.x, y - o.home.y, z - o.home.z) < HOME_EPS && angle(rot, o.home.rot) < HOME_TURN) {
      const bumped = Math.hypot(x - o.home.x, y - o.home.y, z - o.home.z) > .001; // (more than settling: the body is put there too)
      ({ x, y, z, rot } = o.home); q = null; // back exactly where it started: it counts as at home again, so it is neither saved nor sent
      if (bumped) this.physics.nudge(index, { x, y, z, q: yawQuat(rot) });
    }
    const was = o.q ?? yawQuat(o.rot), now = q ?? yawQuat(rot);
    // (a body that has come to rest is written once more only if that changes what it is: upright or not, home or not; never for float noise)
    const differs = (q === null) !== (o.q === null) || (settled && isHome(x, y, z, rot, o) !== isHome(o.x, o.y, o.z, o.rot, o));
    if (Math.hypot(x - o.x, y - o.y, z - o.z) < MOVE_EPS && between(was, now) < TURN_EPS && !differs) return;
    this.writing = true;
    try { setObjectPose(o, x, z, rot, y, q); } finally { this.writing = false; }
  }

  dispose(): void { this.stop(); setPlacer(null); this.physics.free(); }
}
