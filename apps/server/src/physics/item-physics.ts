import { objects, setObjectPose, simEvents, type Quat, type WorldObject } from '@office/shared';
import { Physics, yawQuat, type StaticShape } from './physics';

// Keeps the items and their bodies in step, both ways. When the game moves an item (picked up, put down, put back, restored), its body
// follows; when physics moves a body (it fell, slid, was knocked), the item follows, and the usual `objectMoved` tells every player.
// Only awake bodies are read, so an office at rest costs nothing. See docs/ITEMS-PHYSICS-PLAN.md, step 3.

/** Below these an item has not moved, as far as anyone is told: physics settles in fractions of a millimetre. */
const MOVE_EPS = .001, TURN_EPS = .5 * Math.PI / 180;
/** An item this close to upright is written as upright (`q` null), and one settled this close to its starting pose is put exactly there. */
const UPRIGHT = .5 * Math.PI / 180, HOME_EPS = .003;
/** Put down this much above its surface, so it starts clear of it and settles onto it. */
const LIFT = .002;

/** How far an orientation is turned away from upright, in radians. */
const tiltOf = (q: readonly number[]): number => 2 * Math.asin(Math.min(1, Math.hypot(q[0], q[2])));
/** The way an orientation faces: where it turns the item's own forward (+z), seen from above (the page's rotation.y convention). */
function yawOf(q: readonly number[]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const isHome = (x: number, y: number, z: number, rot: number, o: WorldObject) => x === o.home.x && y === o.home.y && z === o.home.z && rot === o.home.rot;
/** The angle between two orientations, in radians. */
const between = (a: readonly number[], b: readonly number[]) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

export class ItemPhysics {
  readonly physics: Physics;
  private readonly held = new Set<number>();
  private awakeBefore = new Set<number>();
  private writing = false;
  private readonly stop: () => void;

  /** Bodies for every item the world has now, where it is. `loadPhysics()` must have finished. */
  constructor(shapes: readonly StaticShape[]) {
    this.physics = new Physics(shapes);
    for (const o of objects.all()) {
      this.physics.addItem(o, o.q ?? yawQuat(o.rot));
      if (o.carriedBy !== null) { this.physics.setHeld(o.index, true); this.held.add(o.index); }
    }
    this.stop = simEvents.on('objectMoved', o => this.follow(o));
  }

  /** The game moved an item: its body goes there too (or out of the world while somebody holds it). */
  private follow(o: WorldObject): void {
    if (this.writing) return; // (physics moved it: the body is already there)
    if (o.carriedBy !== null) {
      if (!this.held.has(o.index)) { this.physics.setHeld(o.index, true); this.held.add(o.index); }
      return;
    }
    this.physics.place(o.index, { x: o.x, y: o.y + LIFT, z: o.z, q: o.q ?? yawQuat(o.rot) });
    if (this.held.delete(o.index)) this.physics.setHeld(o.index, false);
  }

  /** Advance the physics by `dt` seconds, and move every item whose body moved. */
  step(dt: number): void {
    this.physics.step(dt);
    const awake = new Set(this.physics.awake());
    for (const i of awake) this.read(i, false);
    for (const i of this.awakeBefore) if (!awake.has(i)) this.read(i, true); // (it has just come to rest: its final pose, tidied)
    this.awakeBefore = awake;
  }

  private read(index: number, settled: boolean): void {
    const o = objects.at(index), p = this.physics.pose(index);
    if (!o || !p || o.carriedBy !== null) return;
    let q: Quat | null = tiltOf(p.q) < UPRIGHT ? null : p.q;
    let { x, y, z } = p, rot = yawOf(p.q);
    if (settled && !q && Math.hypot(x - o.home.x, y - o.home.y, z - o.home.z) < HOME_EPS && angle(rot, o.home.rot) < UPRIGHT) {
      ({ x, y, z, rot } = o.home); q = null; // back exactly where it started: it counts as at home again, so it is neither saved nor sent
    }
    const was = o.q ?? yawQuat(o.rot), now = q ?? yawQuat(rot);
    // (a body that has come to rest is written once more only if that changes what it is: upright or not, home or not; never for float noise)
    const differs = (q === null) !== (o.q === null) || (settled && isHome(x, y, z, rot, o) !== isHome(o.x, o.y, o.z, o.rot, o));
    if (Math.hypot(x - o.x, y - o.y, z - o.z) < MOVE_EPS && between(was, now) < TURN_EPS && !differs) return;
    this.writing = true;
    try { setObjectPose(o, x, z, rot, y, q); } finally { this.writing = false; }
  }

  dispose(): void { this.stop(); this.physics.free(); }
}
