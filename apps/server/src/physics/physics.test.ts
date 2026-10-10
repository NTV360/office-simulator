import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DESK_TOP, loadLayout, objects, officeLayout, resetSim, simEvents, slipAngle, type WorldObject } from '@office/shared';
import { Physics, loadPhysics, yawQuat, type StaticShape } from './physics';
import shapes from './office-shapes.json';

// The physics world on its own: the office at rest stays at rest, things fall onto what is under them, and friction holds a mug on a
// slope until the slope passes the mug's slip angle, then it slides (before it would tip). See docs/ITEMS-PHYSICS-PLAN.md, step 3.

const OFFICE = shapes as unknown as StaticShape[];
const run = (p: Physics, seconds: number) => { for (let t = 0; t < seconds; t += .05) p.step(.05); };
const deg = (d: number) => d * Math.PI / 180;
/** How far an item has turned away from upright, in degrees. */
const tilt = (q: number[]) => { const [x, , z] = q; return 2 * Math.asin(Math.min(1, Math.hypot(x, z))) * 180 / Math.PI; };

beforeAll(async () => { await loadPhysics(); });
beforeEach(() => { simEvents.clear(); resetSim(); loadLayout(officeLayout); });

describe('the office at rest', () => {
  it('every one of the 162 items stands where the layout put it: nothing floats, sinks or overlaps, so nothing moves when physics starts', () => {
    const p = new Physics(OFFICE);
    for (const o of objects.all()) p.addItem(o);
    run(p, 3);
    const moved: string[] = [];
    for (const o of objects.all()) {
      const q = p.pose(o.index)!;
      const d = Math.hypot(q.x - o.x, q.y - o.y, q.z - o.z);
      if (d > .02 || tilt(q.q) > 2) moved.push(`${o.id} ${o.type} moved ${(d * 100).toFixed(1)} cm, tilted ${tilt(q.q).toFixed(1)}°`);
    }
    expect(moved).toEqual([]);
    p.free();
  });

  it('everything falls asleep once it has settled, and what is moved wakes and settles again', () => {
    const p = new Physics(OFFICE);
    for (const o of objects.all()) p.addItem(o);
    run(p, 4);
    expect(p.awake()).toEqual([]);
    const mug = objects.all().find(o => o.type === 'mug')!;
    p.place(mug.index, { x: mug.x, y: mug.y + .3, z: mug.z, q: yawQuat(mug.rot) });
    expect(p.awake()).toContain(mug.index);
    run(p, 4);
    expect(p.awake()).toEqual([]);
    p.free();
  });
});

describe('gravity', () => {
  it('a mug let go above a desk lands on the desk top and stays upright', () => {
    const p = new Physics(OFFICE);
    const mug = objects.all().find(o => o.type === 'mug')!;
    p.addItem({ ...mug, y: mug.y + .4 } as WorldObject);
    run(p, 2);
    const at = p.pose(mug.index)!;
    expect(at.y).toBeCloseTo(DESK_TOP, 2);
    expect(Math.hypot(at.x - mug.x, at.z - mug.z)).toBeLessThan(.02);
    expect(tilt(at.q)).toBeLessThan(2);
    p.free();
  });

  it('a chair set down from a little above the floor stands on it, upright', () => {
    const p = new Physics(OFFICE);
    const chair = objects.all().find(o => o.type === 'chair-wood')!;
    p.addItem({ ...chair, y: .1 } as WorldObject);
    run(p, 3);
    const at = p.pose(chair.index)!;
    expect(at.y).toBeCloseTo(0, 2);
    expect(tilt(at.q)).toBeLessThan(2);
    p.free();
  });

  it('a chair dropped from a metre ends at rest on the floor, however it landed (it may well fall over)', () => {
    const p = new Physics(OFFICE);
    const chair = objects.all().find(o => o.type === 'chair-wood')!;
    p.addItem({ ...chair, y: 1 } as WorldObject);
    run(p, 5);
    const at = p.pose(chair.index)!;
    expect(p.awake()).not.toContain(chair.index);
    expect(at.y).toBeGreaterThan(-.01); // (not through the floor)
    expect(at.y).toBeLessThan(.5); // (not stuck in the air or on the table)
    p.free();
  });

  it('what rests on a thing falls when the thing is taken away', () => {
    const p = new Physics(OFFICE);
    const chair = objects.all().find(o => o.type === 'chair-wood')!, mug = objects.all().find(o => o.type === 'mug')!;
    p.addItem(chair);
    p.addItem({ ...mug, x: chair.x, z: chair.z, y: .475 } as WorldObject); // on the dining chair's seat
    run(p, 1);
    expect(p.pose(mug.index)!.y).toBeCloseTo(.475, 2);
    p.removeItem(chair.index); // the chair is not there any more
    run(p, 2);
    expect(p.pose(mug.index)!.y).toBeLessThan(.1); // on the floor (or the chair's old place under it)
    p.free();
  });
});

describe('friction', () => {
  // a wooden board tilted by `angle` about the x axis, and a mug standing on it near the top
  function slope(angle: number) {
    const s = Math.sin(angle), c = Math.cos(angle);
    const board: StaticShape = { s: 'b', size: [1, .04, 3], at: [100, 1, 100], q: [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)] };
    const p = new Physics([board]);
    const mug = objects.all().find(o => o.type === 'mug')!;
    // the board's top surface, one metre up the slope from its middle (the mug's origin is its base)
    const up = -1;
    const x = 100, y = 1 + .02 * c + up * -s, z = 100 + up * c - .02 * s;
    p.addItem({ ...mug, x, y, z, rot: 0 } as WorldObject, [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]);
    run(p, 2);
    const at = p.pose(mug.index)!;
    const slid = Math.hypot(at.x - x, at.y - y, at.z - z);
    p.free();
    return { slid, tilted: tilt(at.q) - angle * 180 / Math.PI };
  }

  it('the slip angle of a ceramic mug on wood is about 25°', () => {
    expect(slipAngle('ceramic', 'wood') * 180 / Math.PI).toBeCloseTo(25.4, 0);
  });
  it('a mug holds on a board tilted well below that', () => {
    expect(slope(deg(15)).slid).toBeLessThan(.02);
  });
  it('and slides down one tilted well past it, without tipping over', () => {
    const { slid, tilted } = slope(deg(32));
    expect(slid).toBeGreaterThan(.3);
    expect(Math.abs(tilted)).toBeLessThan(5);
  });
});
