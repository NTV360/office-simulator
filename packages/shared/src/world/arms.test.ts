import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { resetSim } from '../sim/state';
import { simEvents } from '../sim/events';
import { ARMS, canReach, closestPointOnItem, fromItemFrame, nearestGrip, onItem, toItemFrame } from './arms';
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
