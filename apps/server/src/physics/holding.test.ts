import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { carryPace, objects, people, placeDown, placementProblem, setObjectPose, setSeed, sim, type Person, type WorldObject } from '@office/shared';
import { drop, grab, holdInput, throwIt } from '../play/object-actions';
import { World, type WorldOptions } from '../world/world';
import { loadPhysics, yawQuat, type StaticShape } from './physics';
import shapes from './office-shapes.json';

// Holding things with real hands: an item stays a body, pulled up to carrying height where the hands took it and at the angle it was taken;
// what is on it rides along and slides off when it is turned over; what is too heavy to lift is dragged; a hand pulled too far slips; a
// thing put down is lowered there and let go. The office is paused so people stand where a test puts them. See ITEMS-PHYSICS-PLAN.md, 6.

const base: WorldOptions = { tickRate: 20, slotCount: 10, speed: 1, paused: true, seed: 1 };
let world: World | null = null;
function make(): World {
  world = new World(base);
  world.usePhysics(shapes as unknown as StaticShape[]);
  world.init(null);
  sim.paused = true;
  return world;
}
const tick = (w: World, seconds: number) => { for (let i = 0; i < seconds * 20; i++) w.step(); };
const ofType = (t: string) => objects.all().filter(o => o.type === t);
/** A person standing `d` metres from the item, facing it, from the side given (an angle round it). */
function standBy(o: WorldObject, d: number, from = 0): Person {
  const p = people.find(q => q.state !== 'away')!;
  p.pos.x = o.x + Math.sin(from) * d; p.pos.z = o.z + Math.cos(from) * d; p.face = Math.atan2(o.x - p.pos.x, o.z - p.pos.z);
  p.task = null; p.path = null;
  return p;
}
const yawOf = (o: WorldObject) => { if (!o.q) return o.rot; const [x, y, z, w] = o.q; return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** A place with nothing on the walk grid near it, out in the open: a dining chair's free floor. */
function openFloorNear(o: WorldObject): { x: number; z: number } {
  for (let r = 1.5; r < 5; r += .25) for (let a = 0; a < 6.3; a += .3) {
    const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
    if (placementProblem(o, x, z, o.rot) === null) return { x, z };
  }
  throw new Error('no open floor');
}

beforeAll(async () => { await loadPhysics(); });
afterEach(() => { world?.itemPhysics?.dispose(); world = null; setSeed(null); });

describe('picking something up', () => {
  it('a chair is lifted to carrying height in front of the person, held where the hands took it, at the angle it was taken', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    const before = wrap(yawOf(chair) - p.face);
    expect(grab(p, chair.index).ok).toBe(true);
    tick(w, 2);
    expect(chair.carriedBy).toBe(p.id);
    expect(chair.y).toBeGreaterThan(.3); // off the floor
    const h = chair.holds[0], hand = { x: p.pos.x + Math.sin(p.face) * h.out, z: p.pos.z + Math.cos(p.face) * h.out };
    const g = { x: chair.x, z: chair.z };
    expect(Math.hypot(hand.x - g.x, hand.z - g.z)).toBeLessThan(.6); // (the grip, not the middle, is at the hand)
    expect(Math.abs(wrap(yawOf(chair) - p.face - before))).toBeLessThan(.15); // the same angle to them as when they took it
  });

  it('it goes where they go', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 1.5);
    const start = { x: chair.x, z: chair.z }, to = openFloorNear(chair);
    const dx = (to.x - p.pos.x) / 40, dz = (to.z - p.pos.z) / 40;
    for (let i = 0; i < 40; i++) { p.pos.x += dx; p.pos.z += dz; tick(w, .05); } // two seconds of walking, without turning
    tick(w, 1);
    expect(Math.hypot(chair.x - start.x - dx * 40, chair.z - start.z - dz * 40)).toBeLessThan(.25);
    expect(chair.carriedBy).toBe(p.id);
  });
});

describe('what is on it', () => {
  it('a mug on a chair\'s seat rides along while the chair is carried, and slides off when the chair is turned over', () => {
    const w = make();
    const chair = ofType('chair-wood')[0], mug = ofType('mug')[0];
    setObjectPose(mug, chair.x, chair.z, 0, .475);
    tick(w, 1);
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 2.5);
    const onSeat = () => { const c = { x: chair.x, y: chair.y, z: chair.z }; return Math.hypot(mug.x - c.x, mug.z - c.z) < .3 && mug.y > c.y + .3; };
    expect(onSeat()).toBe(true);
    // turn it over in the hands: 100 degrees about the way they face
    const s = Math.sin(100 * Math.PI / 360);
    chair.holds[0].turn = [0, 0, s, Math.cos(100 * Math.PI / 360)];
    tick(w, 3);
    expect(onSeat()).toBe(false);
    expect(mug.y).toBeLessThan(.2); // on the floor
  });
});

describe('weight', () => {
  it('a sofa is too heavy for one person to lift: it stays on the floor, and is dragged along', () => {
    const w = make();
    const sofa = ofType('sofa')[0];
    const p = standBy(sofa, .55, 0);
    expect(grab(p, sofa.index).ok).toBe(true);
    tick(w, 2);
    expect(sofa.y).toBeLessThan(.05);
    const start = { x: sofa.x, z: sofa.z }, back = { x: -Math.sin(p.face), z: -Math.cos(p.face) };
    for (let i = 0; i < 60; i++) { p.pos.x += back.x * .01; p.pos.z += back.z * .01; tick(w, .05); } // stepping back slowly, pulling
    expect(Math.hypot(sofa.x - start.x, sofa.z - start.z)).toBeGreaterThan(.2);
    expect(sofa.y).toBeLessThan(.05);
  });

  it('carrying something heavy slows you down, and only something light can be run with', () => {
    make();
    const chair = ofType('chair-wood')[0], mug = ofType('mug')[0];
    const p = standBy(chair, .6);
    expect(carryPace(p.id)).toEqual({ factor: 1, run: true });
    grab(p, chair.index);
    expect(carryPace(p.id).factor).toBeCloseTo(1 / (1 + 6 / 40), 6);
    expect(carryPace(p.id).run).toBe(false);
    chair.carriedBy = null; chair.holds = [];
    const q = standBy(mug, .4);
    grab(q, mug.index);
    expect(carryPace(q.id).run).toBe(true);
  });
});

describe('letting go', () => {
  it('a hand pulled too far from where it holds slips off, and the thing falls', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 1.5);
    p.pos.x += 3;
    tick(w, .2);
    expect(chair.carriedBy).toBeNull();
    tick(w, 2);
    expect(chair.y).toBeLessThan(.25);
  });

  it('put down, it is lowered to the place, upright, and let go there', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 1.5);
    const to = { x: p.pos.x + Math.sin(p.face) * .8, z: p.pos.z + Math.cos(p.face) * .8 };
    placeDown(chair, to.x, to.z, p.face, 0);
    tick(w, 2.5);
    expect(chair.carriedBy).toBeNull();
    expect(Math.hypot(chair.x - to.x, chair.z - to.z)).toBeLessThan(.05);
    expect(chair.y).toBeCloseTo(0, 1);
    expect(chair.q).toBeNull();
    expect(Math.abs(wrap(chair.rot - p.face))).toBeLessThan(.05);
  });
});

describe('the angle it is held at', () => {
  it('a chair taken from behind is held from behind: nothing turns it to face the person', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    // stand behind the chair (it faces away from them), take it, and it stays facing away
    const behind = chair.rot + Math.PI, p = standBy(chair, .6, behind);
    grab(p, chair.index);
    tick(w, 2);
    expect(Math.abs(wrap(yawOf(chair) - p.face))).toBeLessThan(.2); // still facing the way they face: its back to them
    expect(chair.q === null || chair.q.every(Number.isFinite)).toBe(true);
    void yawQuat;
  });
});

describe('dropping and throwing', () => {
  it('let go, it falls from where it is held: nothing puts it anywhere first', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 2);
    const held = { x: chair.x, z: chair.z };
    expect(drop(p).ok).toBe(true);
    expect(chair.carriedBy).toBeNull();
    tick(w, 2);
    expect(Math.hypot(chair.x - held.x, chair.z - held.z)).toBeLessThan(.4); // (below where it was, give or take a tumble)
    expect(chair.y).toBeLessThan(.3);
  });

  it('thrown, a mug flies a few metres; a chair, much heavier, only lurches away', () => {
    const w = make();
    const mug = ofType('mug')[0];
    const p = standBy(mug, .45, Math.PI);
    grab(p, mug.index);
    tick(w, 1.5);
    const from = { x: mug.x, z: mug.z };
    expect(throwIt(p, 1).ok).toBe(true);
    tick(w, 3);
    const mugGone = Math.hypot(mug.x - from.x, mug.z - from.z);
    expect(mugGone).toBeGreaterThan(1.5);

    const chair = ofType('chair-wood')[2];
    const q = standBy(chair, .6, 1.0);
    grab(q, chair.index);
    tick(w, 2);
    const at = { x: chair.x, z: chair.z };
    throwIt(q, 1);
    tick(w, 3);
    expect(Math.hypot(chair.x - at.x, chair.z - at.z)).toBeLessThan(mugGone);
  });

  it('turned in the hands, it turns: a quarter turn about the up axis', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const p = standBy(chair, .6, 1.0);
    grab(p, chair.index);
    tick(w, 2);
    const before = yawOf(chair);
    expect(holdInput(p, [0, Math.SQRT1_2, 0, Math.SQRT1_2], 0).ok).toBe(true);
    tick(w, 2);
    expect(Math.abs(wrap(yawOf(chair) - before - Math.PI / 2))).toBeLessThan(.15);
  });

  it('hands raised, it is held higher', () => {
    const w = make();
    const mug = ofType('mug')[0];
    const p = standBy(mug, .45, Math.PI);
    grab(p, mug.index);
    tick(w, 2);
    const y0 = mug.y;
    holdInput(p, [0, 0, 0, 1], .4);
    tick(w, 3);
    expect(mug.y).toBeGreaterThan(y0 + .25);
  });
});
