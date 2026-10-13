import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { resetSim } from '../sim/state';
import { simEvents } from '../sim/events';
import { ARMS, canReach, closestPointOnItem, fromItemFrame, gripPair, gripSpots, nearestGrip, onItem, gripsToLocal, regripPair, shoulders, toItemFrame } from './arms';
import { objects, setObjectPose } from './objects';

// Where a hand can take an item: the point of it nearest to where you aim, and whether your arm gets there from where you stand.

beforeEach(() => { simEvents.clear(); resetSim(); loadLayout(officeLayout); });
const ofType = (t: string) => objects.all().filter(o => o.type === t);
const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, d = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < d;

describe('an item\'s own frame', () => {
  it('turns the way the page draws it: facing a quarter turn, its own +x points to -z in the world', () => {
    const mug = ofType('mug')[0];
    setObjectPose(mug, 1, 2, Math.PI / 2, .76);
    const w = fromItemFrame(mug, { x: 1, y: 0, z: 0 });
    expect(near(w, { x: 1, y: .76, z: 1 })).toBe(true);
    expect(near(toItemFrame(mug, w), { x: 1, y: 0, z: 0 })).toBe(true);
  });
  it('and lying on its side, it goes there and back the same', () => {
    const mug = ofType('mug')[0];
    setObjectPose(mug, 1, .8, 2, .8, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const p = { x: .3, y: -.2, z: .5 };
    expect(near(toItemFrame(mug, fromItemFrame(mug, p)), p)).toBe(true);
  });
});

describe('the point of an item nearest to a point', () => {
  it('a mug: from beside it, its side; from inside it, the point itself', () => {
    const mug = ofType('mug')[0];
    const side = closestPointOnItem(mug, { x: mug.x + 1, y: mug.y + .05, z: mug.z });
    expect(side.x - mug.x).toBeCloseTo(.0375, 6);
    expect(side.y).toBeCloseTo(mug.y + .05, 6);
    const inside = { x: mug.x, y: mug.y + .05, z: mug.z };
    expect(near(closestPointOnItem(mug, inside), inside)).toBe(true);
  });
  it('a chair: from just above the front of its seat, the seat; from high above, the top of its back (it is nearer)', () => {
    const chair = ofType('chair-wood')[0];
    const seat = closestPointOnItem(chair, fromItemFrame(chair, { x: 0, y: .6, z: .15 }));
    expect(seat.y).toBeCloseTo(.475, 3);
    const top = closestPointOnItem(chair, { x: chair.x, y: 3, z: chair.z });
    expect(top.y).toBeCloseTo(.9, 3);
  });
  it('a point on the item counts, one a hand-width off does not', () => {
    const mug = ofType('mug')[0];
    expect(onItem(mug, { x: mug.x + .0375, y: mug.y + .05, z: mug.z })).toBe(true);
    expect(onItem(mug, { x: mug.x + .2, y: mug.y + .05, z: mug.z })).toBe(false);
  });
});

describe('reach', () => {
  const at = (x: number, z: number) => ({ pos: { x, z } });
  it('a hand gets as far as the arm and a little lean, from the floor up to above the head', () => {
    expect(canReach(at(0, 0), { x: ARMS.reach - .01, y: 1, z: 0 })).toBe(true);
    expect(canReach(at(0, 0), { x: ARMS.reach + .05, y: 1, z: 0 })).toBe(false);
    expect(canReach(at(0, 0), { x: .3, y: 0, z: 0 })).toBe(true); // (bending down)
    expect(canReach(at(0, 0), { x: .3, y: 2.5, z: 0 })).toBe(false);
  });
  it('a person standing next to a desk reaches the mug on it; the same person two metres off does not', () => {
    const mug = ofType('mug')[0];
    const grip = (p: { pos: { x: number; z: number } }) => nearestGrip(mug, p);
    const close = at(mug.x + .5, mug.z), far = at(mug.x + 2, mug.z);
    expect(canReach(close, grip(close))).toBe(true);
    expect(canReach(far, grip(far))).toBe(false);
  });
});

describe('where a hand takes hold', () => {
  it('every grip spot of every kind is on the item itself', () => {
    const seen = new Set<string>();
    for (const o of objects.all()) {
      if (seen.has(o.type)) continue; seen.add(o.type);
      const spots = gripSpots(o);
      expect(spots.length, o.type).toBeGreaterThan(0);
      for (const g of spots) expect(near(closestPointOnItem(o, g), g, 1e-5), o.type).toBe(true);
    }
  });

  it('a TV is taken by two places apart on its frame and stand, never by the middle of its flat face', () => {
    const tv = ofType('tv-stand')[0];
    const chest = { pos: { x: tv.x + .6, z: tv.z } };
    const centre = fromItemFrame(tv, { x: 0, y: 1.3, z: .03 }); // the middle of the screen's face
    const { left, right, mid } = gripPair(tv, chest, centre, false);
    expect(left).not.toBeNull();
    expect(Math.hypot(left!.x - right.x, left!.y - right.y, left!.z - right.z)).toBeGreaterThan(.3); // two hands, apart
    for (const g of [left!, right]) expect(Math.hypot(g.x - centre.x, g.y - centre.y, g.z - centre.z)).toBeGreaterThan(.15); // not the middle of the face
    expect(near(mid, { x: (left!.x + right.x) / 2, y: (left!.y + right.y) / 2, z: (left!.z + right.z) / 2 })).toBe(true);
  });

  it('a one-hand thing is taken at one grip spot, with the right hand', () => {
    const mug = ofType('mug')[0];
    const g = gripPair(mug, { pos: { x: mug.x + .4, z: mug.z } }, closestPointOnItem(mug, { x: mug.x + .4, y: mug.y + .05, z: mug.z }), true);
    expect(g.left).toBeNull();
    expect(near(g.mid, g.right)).toBe(true);
    expect(gripSpots(mug).some(s => near(s, g.right))).toBe(true);
  });

  it('the two hands of a chair are on its own sides, left of the person on the left', () => {
    const chair = ofType('chair-wood')[0];
    const person = { pos: { x: chair.x + .6, z: chair.z } }, aim = closestPointOnItem(chair, { x: person.pos.x, y: 1.0, z: person.pos.z });
    const { left, right } = gripPair(chair, person, aim, false);
    const yaw = Math.atan2(aim.x - person.pos.x, aim.z - person.pos.z), lx = Math.cos(yaw), lz = -Math.sin(yaw);
    expect((left!.x - right.x) * lx + (left!.z - right.z) * lz).toBeGreaterThan(0); // (the left hand is further to their left)
  });
});

describe('keeping a good grip as the item is turned and raised', () => {
  // a person facing -x with the item held out in front of them
  const person = { pos: { x: 0, z: 0 }, face: -Math.PI / 2 };
  const hold = (type: string, rot: number, y = 1.0, q?: [number, number, number, number]) => {
    const o = ofType(type)[0];
    setObjectPose(o, -.45, 0, rot, y - .3, q); // (the item's own origin; its grips are around it)
    return o;
  };
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const sane = (o: ReturnType<typeof hold>, g: ReturnType<typeof regripPair>, label: string) => {
    const sh = shoulders(person), lat = { x: Math.cos(person.face), z: -Math.sin(person.face) };
    expect(g.left, label).not.toBeNull();
    expect(dist(g.left!, sh.left), label + ': left arm reaches').toBeLessThanOrEqual(ARMS.length * ARMS.stretchMax + 1e-6);
    expect(dist(g.right, sh.right), label + ': right arm reaches').toBeLessThanOrEqual(ARMS.length * ARMS.stretchMax + 1e-6);
    expect((g.left!.x - g.right.x) * lat.x + (g.left!.z - g.right.z) * lat.z, label + ': left hand on the left').toBeGreaterThan(0);
    for (const h of [g.left!, g.right]) expect(gripSpots(o).some(s => near(s, h, 1e-6)), label + ': on a grip spot').toBe(true);
  };

  it('a chair turned all the way round, over and up and down is always held with the left hand on the left, within reach, on its grip spots', () => {
    let prev: ReturnType<typeof gripsToLocal> | null = null;
    for (const [label, rot, y, q] of [
      ['as taken', 0, 1.0, undefined], ['a quarter turn', Math.PI / 2, 1.0, undefined], ['half a turn', Math.PI, 1.0, undefined], ['three quarters', 1.5 * Math.PI, 1.0, undefined],
      ['raised', 0, 1.6, undefined], ['lowered', 0, .75, undefined],
      ['on its back', 0, 1.0, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]], ['upside down', 0, 1.0, [1, 0, 0, 0]],
    ] as const) {
      const o = hold('chair-wood', rot, y, q as never);
      const g = regripPair(o, person, false, prev);
      sane(o, g, label); prev = gripsToLocal(o, g);
    }
  });

  it('keeps the grip it has while it is still a good one, so the hands do not wander', () => {
    const o = hold('chair-wood', 0);
    const first = regripPair(o, person, false, null), local = gripsToLocal(o, first);
    const again = regripPair(o, person, false, local);
    expect(near(again.right, first.right) && near(again.left!, first.left!)).toBe(true); // (the same spots, not new ones)
    setObjectPose(o, -.47, .01, .05, .7); // (a nudge: still fine, and the hands go with the item)
    const moved = regripPair(o, person, false, local);
    expect(near(moved.right, fromItemFrame(o, local.right))).toBe(true);
  });

  it('takes a new grip when the hands have crossed, and keeps the old one otherwise', () => {
    const o = hold('chair-wood', 0);
    const g = regripPair(o, person, false, null);
    const crossed = gripsToLocal(o, { left: g.right, right: g.left!, mid: g.mid });
    const fixed = regripPair(o, person, false, crossed);
    sane(o, fixed, 'crossed hands put right');
  });

  it('a TV is carried by its rim at the hands, whichever way it is turned', () => {
    let prev: ReturnType<typeof gripsToLocal> | null = null;
    for (const rot of [0, Math.PI / 2, Math.PI]) { const o = hold('tv-stand', rot, 1.0); const g = regripPair(o, person, false, prev); sane(o, g, 'tv ' + rot.toFixed(2)); prev = gripsToLocal(o, g); }
  });

  it('a mug in one hand always has the right hand on it', () => {
    const o = hold('mug', 1.2, 1.0);
    const g = regripPair(o, person, true, null);
    expect(g.left).toBeNull();
    expect(dist(g.right, shoulders(person).right)).toBeLessThanOrEqual(ARMS.length * ARMS.stretchMax + 1e-6);
  });
});
