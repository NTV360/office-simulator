import RAPIER from '@dimforge/rapier3d-compat';
import { CATALOGUE, MATERIALS, shapeOf, type Collider, type Triple, type WorldObject } from '@office/shared';

// The office as rigid bodies: the building and the fixed furniture as solid shapes, every item as a body with its real mass, shapes and
// material, under gravity. Bodies at rest sleep and cost nothing. A plain class with no Nest in it (see docs/CODING-STANDARDS.md);
// the world owns one. See docs/ITEMS-PHYSICS-PLAN.md, section 2 and step 3.

/** A fixed shape in the office, in metres, as scripts/dump-layout.mjs writes it (apps/server/src/physics/office-shapes.json). */
export type StaticShape =
  | { s: 'b'; size: Triple; at: Triple; q?: readonly [number, number, number, number] }
  | { s: 'c'; r: number; h: number; at: Triple; q?: readonly [number, number, number, number] }
  | { s: 's'; r: number; at: Triple };

/** Where an item is: its origin (the point it stands on) and its orientation as a quaternion. */
export interface BodyPose { x: number; y: number; z: number; q: [number, number, number, number] }

/** What the fixed furniture and the floor are made of, to the physics (they carry no material of their own yet). */
const FIXED = { friction: MATERIALS.wood.friction, bounce: MATERIALS.wood.bounce };
/**
 * Who touches whom (Rapier collision groups: what a collider is, in the high 16 bits; what it touches, in the low 16): the building and the
 * fixed furniture, big furniture, and small things. Normally everything touches everything; a thing being put down touches only small things
 * (see `setPassThrough`).
 */
const FIXED_GROUP = 0x0001, BIG_GROUP = 0x0002, SMALL_GROUP = 0x0004, EVERYTHING = 0xffff;
const groups = (is: number, touches: number) => (is << 16) | touches;

/** Each tick is split into steps this long: short enough for a mug landing on a desk not to sink in. */
export const SUBSTEP = 1 / 60;
export const GRAVITY = 9.81;

let ready: Promise<void> | null = null;
/** Load the physics engine (WebAssembly) once; every Physics needs it first. */
export function loadPhysics(): Promise<void> { return (ready ??= RAPIER.init()); }

/** The rotation about the vertical axis by `rot`, as the page draws it (frame(): rotation.y = rot). */
export const yawQuat = (rot: number): [number, number, number, number] => [0, Math.sin(rot / 2), 0, Math.cos(rot / 2)];

const volumeOf = (c: Collider): number =>
  c.shape === 'box' ? c.size[0] * c.size[1] * c.size[2] : c.shape === 'cylinder' ? Math.PI * c.radius ** 2 * c.height : 4 / 3 * Math.PI * c.radius ** 3;

function eulerQuat([x, y, z]: Triple): RAPIER.Rotation {
  // x, then y, then z (three.js 'XYZ' order)
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return { x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz - sx * cy * sz, z: cx * cy * sz + sx * sy * cz, w: cx * cy * cz - sx * sy * sz };
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly bodies = new Map<number, RAPIER.RigidBody>();
  private carry = 0; // time not stepped yet, less than one substep

  /** Build the fixed world. `loadPhysics()` must have finished. */
  constructor(shapes: readonly StaticShape[]) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = SUBSTEP;
    // (the default 4 lets a mug landing flat on a desk skid several centimetres; 12 keeps it under half a centimetre)
    this.world.integrationParameters.numSolverIterations = 12;
    const fixed = (desc: RAPIER.ColliderDesc, at: Triple, q?: readonly number[]) => {
      desc.setTranslation(at[0], at[1], at[2]).setFriction(FIXED.friction).setRestitution(FIXED.bounce).setCollisionGroups(groups(FIXED_GROUP, EVERYTHING));
      if (q) desc.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
      this.world.createCollider(desc);
    };
    // the floor: a thick slab under everything, wider than the office
    let lo = Infinity, hi = -Infinity;
    for (const s of shapes) { lo = Math.min(lo, s.at[0], s.at[2]); hi = Math.max(hi, s.at[0], s.at[2]); }
    const half = Number.isFinite(lo) ? Math.max(Math.abs(lo), Math.abs(hi)) + 20 : 100;
    fixed(RAPIER.ColliderDesc.cuboid(half, .5, half), [0, -.5, 0]);
    for (const s of shapes) {
      if (s.s === 'b') fixed(RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2), s.at, s.q);
      else if (s.s === 'c') fixed(RAPIER.ColliderDesc.cylinder(s.h / 2, s.r), s.at, s.q);
      else fixed(RAPIER.ColliderDesc.ball(s.r), s.at);
    }
  }

  /**
   * Give an item its body, where it is now, upright and facing its way (or with the orientation given). It starts awake and falls asleep
   * by itself once it is still (a second or two): a body made asleep has no contacts yet, and sinks into the floor for a moment when woken.
   */
  addItem(o: WorldObject, q: [number, number, number, number] = yawQuat(o.rot)): RAPIER.RigidBody {
    const t = CATALOGUE[o.type];
    if (!t) throw new Error(`unknown item type "${o.type}"`);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x, o.y, o.z).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
      .setCanSleep(true).setCcdEnabled(t.mass < 1); // (small things would pass through a thin shelf when they fall fast)
    const body = this.world.createRigidBody(desc);
    const colliders = shapeOf(o).colliders, total = colliders.reduce((v, c) => v + volumeOf(c), 0);
    for (const c of colliders) {
      const cd = c.shape === 'box' ? RAPIER.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2)
        : c.shape === 'cylinder' ? RAPIER.ColliderDesc.cylinder(c.height / 2, c.radius) : RAPIER.ColliderDesc.ball(c.radius);
      const m = MATERIALS[c.material ?? t.material];
      cd.setTranslation(c.at[0], c.at[1], c.at[2]).setFriction(m.friction).setRestitution(m.bounce).setMass(t.mass * volumeOf(c) / total)
        .setCollisionGroups(groups(shapeOf(o).foot ? BIG_GROUP : SMALL_GROUP, EVERYTHING));
      if (c.shape !== 'sphere' && c.rot) cd.setRotation(eulerQuat(c.rot));
      this.world.createCollider(cd, body);
    }
    this.bodies.set(o.index, body);
    this.setBig(o, false);
    return body;
  }

  /**
   * Furniture that blocks the floor (a table, a sofa, a cabinet) is not shoved by smaller things knocking into it while it stands there: it
   * outranks them (a higher dominance group: to them it is as good as fixed). Held, it is an ordinary body again, so what is on it rides along.
   */
  setBig(o: WorldObject, held: boolean): void {
    const b = this.bodies.get(o.index);
    if (b) b.setDominanceGroup(shapeOf(o).foot && !held ? 1 : 0);
  }

  /**
   * A thing being put down goes to its place through fixed and big furniture (a chair set down beside a desk does not catch on the desk's
   * edge on the way), touching only small things (what rides on it still rides). Back to touching everything once it is down.
   */
  setPassThrough(o: WorldObject, on: boolean): void {
    const b = this.bodies.get(o.index);
    if (!b) return;
    const is = shapeOf(o).foot ? BIG_GROUP : SMALL_GROUP;
    for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(groups(is, on ? SMALL_GROUP : EVERYTHING));
  }

  /** Set a resting item's pose without waking it (a tidy-up of a few millimetres, not a move). */
  nudge(index: number, pose: BodyPose): void {
    const b = this.bodies.get(index);
    if (!b) return;
    b.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, false);
    b.setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }, false);
  }

  /** Forget an item's body. */
  removeItem(index: number): void {
    const b = this.bodies.get(index);
    if (b) { this.world.removeRigidBody(b); this.bodies.delete(index); }
  }

  body(index: number): RAPIER.RigidBody | undefined { return this.bodies.get(index); }

  /** Move an item to a pose at once (put down, reset) and let it settle from there; what rests on it, or under it, wakes too. */
  place(index: number, pose: BodyPose): void {
    const b = this.bodies.get(index);
    if (!b) return;
    b.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    b.setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Advance by `dt` seconds of real time, in fixed substeps (a slower or faster day clock does not change how things fall). `before` runs
   * before each substep: the hands holding things push on them there.
   */
  step(dt: number, before?: () => void): void {
    this.carry += dt;
    let n = 0;
    while (this.carry >= SUBSTEP && n < 8) { before?.(); this.world.step(); this.carry -= SUBSTEP; n++; }
    if (n === 8) this.carry = 0; // far behind: drop the rest rather than spiral
  }

  pose(index: number): BodyPose | null {
    const b = this.bodies.get(index);
    if (!b) return null;
    const t = b.translation(), r = b.rotation();
    return { x: t.x, y: t.y, z: t.z, q: [r.x, r.y, r.z, r.w] };
  }

  /** The items whose bodies are moving now (awake and in the simulation). */
  awake(): number[] {
    const out: number[] = [];
    for (const [i, b] of this.bodies) if (b.isEnabled() && !b.isSleeping()) out.push(i);
    return out;
  }

  free(): void { this.world.free(); this.bodies.clear(); }
}
