import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DESK_TOP, isAtHome, movedObjects, objects, parseSavedWorld, pickUp, placementProblem, putDown, serializeWorld, setObjectPose, setSeed, simEvents, type WorldObject } from '@office/shared';
import { World, type WorldOptions } from '../world/world';
import { loadPhysics, type StaticShape } from './physics';
import shapes from './office-shapes.json';

// The physics inside the running world: an office at rest stays exactly as it was (nothing is sent, nothing is saved as moved), what the
// game moves the bodies follow, and what physics moves every player is told about and the save keeps. See docs/ITEMS-PHYSICS-PLAN.md, step 3.

const base: WorldOptions = { tickRate: 20, slotCount: 10, speed: 1, paused: false, seed: 1 };
let world: World | null = null;
function make(saved: ReturnType<typeof parseSavedWorld> | null = null): World {
  world = new World(base);
  world.usePhysics(shapes as unknown as StaticShape[]);
  world.init(saved);
  return world;
}
const tick = (w: World, seconds: number) => { for (let i = 0; i < seconds * 20; i++) w.step(); };
/** Count the `objectMoved` announcements (what the server sends every player) while `fn` runs. */
function told(fn: () => void): Map<number, number> {
  const seen = new Map<number, number>();
  const stop = simEvents.on('objectMoved', o => seen.set(o.index, (seen.get(o.index) ?? 0) + 1));
  try { fn(); } finally { stop(); }
  return seen;
}
const ofType = (t: string) => objects.all().filter(o => o.type === t);
/** A place the game would let this chair be put, a metre or two from where it is. */
function freeSpot(o: WorldObject): { x: number; z: number } {
  for (let r = 1.5; r < 4; r += .25) for (let a = 0; a < 6.28; a += .2) {
    const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
    if (placementProblem(o, x, z, o.rot) === null) return { x, z };
  }
  throw new Error('no free place near ' + o.id);
}

beforeAll(async () => { await loadPhysics(); });
afterEach(() => { world?.itemPhysics?.dispose(); world = null; setSeed(null); });

describe('an office at rest', () => {
  it('stays exactly as it was: nothing moves, nobody is told anything, nothing counts as moved for the save', () => {
    const w = make();
    const sent = told(() => tick(w, 4));
    expect(sent.size).toBe(0);
    expect(movedObjects()).toEqual([]);
    expect(w.itemPhysics!.physics.awake()).toEqual([]); // (and it is all asleep: it costs nothing)
  });

  it('a restored world keeps its moved things where they were saved', () => {
    const w = make();
    const chair = ofType('chair-wood')[0], to = freeSpot(chair);
    setObjectPose(chair, to.x, to.z, chair.rot);
    tick(w, 2);
    const saved = parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld())));
    w.itemPhysics!.dispose();
    const again = make(saved);
    tick(again, 2);
    const back = objects.at(chair.index)!;
    expect(back.x).toBeCloseTo(to.x, 3);
    expect(back.z).toBeCloseTo(to.z, 3);
    expect(back.y).toBeCloseTo(0, 3);
  });
});

describe('what the game moves, the bodies follow', () => {
  it('a chair put down somewhere else stands there and stays exactly where it was put', () => {
    const w = make();
    const chair = ofType('chair-wood')[0], to = freeSpot(chair);
    pickUp(chair, 1);
    putDown(chair, to.x, to.z, chair.rot);
    tick(w, 3);
    expect(chair.x).toBe(to.x);
    expect(chair.z).toBe(to.z);
    expect(chair.y).toBe(0);
    expect(chair.q).toBeNull();
  });

  it('put back, it is at home again exactly (so it is neither sent nor saved)', () => {
    const w = make();
    const chair = ofType('chair-wood')[0];
    const to = freeSpot(chair);
    pickUp(chair, 1); putDown(chair, to.x, to.z, chair.rot);
    tick(w, 2);
    pickUp(chair, 1); putDown(chair, chair.home.x, chair.home.z, chair.home.rot);
    tick(w, 3);
    expect(isAtHome(chair)).toBe(true);
  });
});

describe('what physics moves, everybody is told', () => {
  it('a mug let go above its desk falls onto it, and the players are told as it falls', () => {
    const w = make();
    const mug = ofType('mug')[0];
    setObjectPose(mug, mug.x, mug.z, mug.rot, DESK_TOP + .3);
    const sent = told(() => tick(w, 2));
    expect(sent.get(mug.index)).toBeGreaterThan(3);
    expect(mug.y).toBeCloseTo(DESK_TOP, 2);
    expect(mug.q).toBeNull();
  });

  it('a mug on a chair falls when somebody picks the chair up, lands on the floor, and the save keeps it there', () => {
    const w = make();
    const chair = ofType('chair-wood')[0], mug = ofType('mug')[0];
    setObjectPose(mug, chair.x, chair.z, 0, .475); // on the seat (not a place the game lets you put it yet: holding comes in step 6)
    tick(w, 2);
    expect(mug.y).toBeCloseTo(.475, 2); // it rests there
    const sent = told(() => { pickUp(chair, 1); tick(w, 3); });
    expect(sent.get(mug.index)).toBeGreaterThan(3);
    expect(mug.y).toBeLessThan(.2); // on the floor, standing or lying
    const saved = serializeWorld().objects.find(s => s.id === mug.id)!;
    expect(saved.y).toBeCloseTo(mug.y, 5);
    expect(saved.q ?? null).toEqual(mug.q);
  });

  it('a mug let go beside a desk falls past its edge to the floor', () => {
    const w = make();
    const mug = ofType('mug')[0];
    // straight out from its seat, over the desk's edge and past it: the next stop is the floor
    const seat = objects.all().find(o => o.station === mug.station && o.type === 'chair-office') as WorldObject;
    const away = Math.atan2(seat.x - mug.x, seat.z - mug.z), out = .05;
    setObjectPose(mug, seat.x - Math.sin(away) * out, seat.z - Math.cos(away) * out, 0, 1.4);
    tick(w, 4);
    expect(mug.y).toBeLessThan(DESK_TOP); // not on the desk
  });
});
