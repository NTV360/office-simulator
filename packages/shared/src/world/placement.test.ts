import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { initDay } from '../sim/day';
import { simEvents } from '../sim/events';
import { interactables } from '../sim/interactables';
import { isHelper } from '../sim/person';
import { initState, meetings, people, resetSim, sim } from '../sim/state';
import { stepSim } from '../sim/step';
import { Vec3 } from '../vec3';
import { setSeed } from '../util';
import { findPath } from '../nav/astar';
import { walkPx } from '../nav/grid';
import { toPx } from '../plan';
import { parseSavedWorld, serializeWorld } from '../sim/persist';
import { ENTRY } from '../sim/spots';
import { CATALOGUE, DESK_TOP } from './catalogue';
import { addObject, objects, putDown, resetAllObjects, seatUnusable, setObjectPose, wrapAngle, type WorldObject } from './objects';
import { REACH, inReach, movability, nearestMovable, placementProblem, restHeightAt, seatInUse, setFixedTops, stationOwner } from './placement';

// The rules for moving things: where a chair or a small thing may be put, and when it may not be moved at all.

beforeEach(() => { simEvents.clear(); setSeed(1); resetSim(); loadLayout(officeLayout); initState(); });

const ofType = (type: string) => objects.all().filter(o => o.type === type);
/** A place near the object where it may be put (not where it is), searching outwards in rings of 15 cm. */
function freePlaceNear(o: WorldObject): { x: number; z: number } {
  for (let r = .3; r < 3; r += .15) for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
    if (placementProblem(o, x, z, o.rot) === null) return { x, z };
  }
  throw new Error('no free place near ' + o.id);
}

describe('where things may be put', () => {
  it('every object may be at its starting place (back where it started is always allowed)', () => {
    for (const o of objects.all()) expect(placementProblem(o, o.home.x, o.home.z, o.home.rot), o.id).toBeNull();
  });

  it('a chair may be moved to open floor, and its seat and the place people walk to go with it', () => {
    const chair = ofType('chair-wood')[0], seat = chair.link!.spot;
    const { x, z } = freePlaceNear(chair);
    expect(placementProblem(chair, x, z, chair.rot)).toBeNull();
    const before = { seat: seat.pos.clone(), approach: seat.approach.clone() };
    setObjectPose(chair, x, z, chair.rot);
    expect(seat.pos.x - before.seat.x).toBeCloseTo(x - chair.home.x, 6);
    expect(seat.approach.z - before.approach.z).toBeCloseTo(z - chair.home.z, 6);
    expect(findPath(ENTRY, seat.approach), 'the moved seat can still be walked to').not.toBeNull();
  });

  it('is refused inside a wall, outside the building, or off the numbers', () => {
    const chair = ofType('chair-wood')[0];
    expect(placementProblem(chair, 500, 500, 0)).toBe('blocked');
    expect(placementProblem(chair, NaN, 0, 0)).toBe('blocked');
    expect(placementProblem(chair, 0, 0, Infinity)).toBe('blocked');
    const wall = ofType('chair-office')[0];
    expect(placementProblem(wall, wall.x, wall.z + 80, 0)).toBe('blocked'); // (far outside the office)
  });

  it('is refused on top of another chair, or too close to one (the sum of their radii)', () => {
    const [a, b] = ofType('chair-wood');
    expect(placementProblem(a, b.x, b.z, 0)).toBe('crowded');
    const need = CATALOGUE['chair-wood'].radius * 2;
    expect(placementProblem(a, b.x + need - .02, b.z, 0)).toBe('crowded');
  });

  it('is refused where the seat could not be walked to: there are places that pass the floor and the crowd tests and still fail this one', () => {
    const chair = objects.all().find(o => o.link?.spot.kind === 'booth')!; // (a phone booth's seat is not where people stand to use it)
    let refused = 0;
    for (let x = chair.x - 4; x < chair.x + 4; x += .2) for (let z = chair.z - 4; z < chair.z + 4; z += .2) if (placementProblem(chair, x, z, chair.rot) === 'unreachable') refused++;
    expect(refused).toBeGreaterThan(0);
  });

  it('a small thing goes on a desk, anyone\'s, and not on another small thing', () => {
    const mug = ofType('mug')[0];
    const notebook = addObject({ type: 'notebook', x: mug.x + .3, z: mug.z, rot: 0, y: mug.y, variant: 0, station: mug.station, spot: null }); // (one more thing on the same desk)
    expect(placementProblem(mug, mug.x + .05, mug.z, mug.rot)).toBeNull(); // a shuffle along the same desk
    expect(placementProblem(mug, mug.x, mug.z + 6, mug.rot)).toBe('off-desk'); // across the room
    expect(placementProblem(mug, notebook.x, notebook.z, 0)).toBe('crowded');
    const otherDesk = ofType('mug').find(m => Math.hypot(m.x - mug.x, m.z - mug.z) > 8)!;
    expect(placementProblem(mug, otherDesk.x, otherDesk.z, 0), 'not on top of the mug there').toBe('crowded');
    const beside = [[.15, 0], [-.15, 0], [0, .15], [0, -.15]].map(([dx, dz]) => placementProblem(mug, otherDesk.x + dx, otherDesk.z + dz, 0));
    expect(beside, 'beside it, on somebody else\'s desk, is fine').toContain(null);
    expect(placementProblem(mug, mug.x, mug.z - 6, mug.rot), 'nor on the floor between desks').toBe('off-desk');
  });

  it('nothing can be put on a fixed or unknown thing: only what the catalogue lets move is movable at all', () => {
    const chair = ofType('chair-wood')[0];
    expect(movability({ ...chair, type: 'table' } as WorldObject)).toBe('not-movable');
    expect(placementProblem({ ...chair, type: 'table' } as WorldObject, 0, 0, 0)).toBe('not-movable');
  });
});

describe('what a review found', () => {
  it('an angle far outside one turn is wrapped when a thing is put down (a saved world refuses one beyond 1000)', () => {
    const chair = ofType('chair-wood')[0];
    chair.carriedBy = 5;
    putDown(chair, chair.x + 1, chair.z, 5000);
    expect(Math.abs(chair.rot)).toBeLessThanOrEqual(Math.PI);
    expect(wrapAngle(5000)).toBeGreaterThan(-Math.PI - 1e-9);
    expect(wrapAngle(5000)).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(wrapAngle(5000))).toBeCloseTo(Math.cos(5000), 9);
    for (const a of [0, 1, -1, Math.PI, -Math.PI + .001]) expect(wrapAngle(a), 'one in range is untouched').toBe(a);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 9);
    const world = parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld())));
    expect(world.objects.length).toBe(1);
  });

  it('back where it started is not allowed once another chair has been put there', () => {
    const [a, b] = ofType('chair-wood');
    setObjectPose(a, a.x + 2, a.z + 2, 0);
    setObjectPose(b, a.home.x, a.home.z, 0); // b sits on a's starting place
    expect(placementProblem(a, a.home.x, a.home.z, a.home.rot)).toBe('crowded');
    setObjectPose(b, b.home.x, b.home.z, b.home.rot);
    expect(placementProblem(a, a.home.x, a.home.z, a.home.rot)).toBeNull();
  });

  it('the seat itself must be on open floor, not only the chair and the place people stand', () => {
    // a chair whose seat is a metre and a half from it (so the two can be on different sides of a wall), found at a place where the chair is on floor and the seat is not
    const s = interactables.of('lounge')[0];
    const o = addObject({ type: 'chair-wood', x: s.pos.x + 1.5, z: s.pos.z, rot: 0, y: 0, variant: 0, station: null, spot: s.id });
    let found: { x: number; z: number } | null = null;
    for (let x = -30; x < 30 && !found; x += .25) for (let z = -30; z < 60 && !found; z += .25) {
      const [cx, cy] = toPx({ x, z }), [sx, sy] = toPx({ x: x - 1.5, z });
      if (walkPx(cx, cy) && !walkPx(sx, sy)) found = { x, z };
    }
    expect(found, 'such a place exists in the office').not.toBeNull();
    expect(placementProblem(o, found!.x, found!.z, 0)).toBe('blocked');
  });
});

describe('when a thing may not be moved', () => {
  it('not while somebody sits in the chair, or is walking to it', () => {
    initDay();
    const chair = ofType('chair-wood')[0], seat = chair.link!.spot;
    expect(movability(chair)).toBeNull();
    seat.occupant = people[0];
    expect(seatInUse(seat)).toBe(true);
    expect(movability(chair)).toBe('in-use');
    seat.occupant = null;
    people[1].task = { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: seat } as never; people[1].state = 'walking';
    expect(movability(chair)).toBe('in-use');
    people[1].task = null;
    expect(movability(chair)).toBeNull();
  });

  it('not while somebody carries it', () => {
    const chair = ofType('chair-wood')[0];
    chair.carriedBy = 3;
    expect(movability(chair)).toBe('carried');
  });

  it('it belongs to a station: the owner of the desk is who may move it (a shared place has none)', () => {
    initDay();
    const owned = (o: WorldObject) => !!interactables.all().find(s => s.id === o.station)?.owner;
    const desk = ofType('chair-office').find(o => o.station && owned(o))!, shared = ofType('chair-wood')[0];
    const owner = interactables.all().find(s => s.id === desk.station)!.owner as { owner?: number };
    owner.owner = 77;
    expect(stationOwner(desk)!.account).toBe(77);
    expect(stationOwner(shared)).toBeNull();
  });

  it('nearestMovable finds the closest thing in reach that can be moved, and not one that is carried', () => {
    const chair = ofType('chair-wood')[0];
    expect(nearestMovable(chair.x + .1, chair.z)).toBe(chair);
    expect(nearestMovable(chair.x + 40, chair.z)).toBeNull();
    chair.carriedBy = 1;
    expect(nearestMovable(chair.x + .1, chair.z)).not.toBe(chair);
    expect(inReach({ pos: { x: 0, z: 0 } }, REACH - .1, 0)).toBe(true);
    expect(inReach({ pos: { x: 0, z: 0 } }, REACH + .1, 0)).toBe(false);
  });
});

describe('the autopilot and the moved things', () => {
  const run = (minutes: number) => { const until = sim.t + minutes; while (sim.t < until) stepSim(.05); };

  it('somebody uses a dining chair at its new place', () => {
    initDay();
    const seen = new Set<number>();
    const chairs = ofType('chair-wood');
    for (const c of chairs) { const p = freePlaceNear(c); setObjectPose(c, p.x, p.z, c.rot); }
    let sat = 0;
    for (let i = 0; i < 6000 && sat < 5; i++) {
      stepSim(.05);
      for (const p of people) {
        const spot = p.task?.spot;
        if (p.state === 'doing' && spot && typeof spot.object === 'string' && chairs.some(c => c.id === spot.object) && !seen.has(p.id)) {
          const c = objects.byId(spot.object as string)!;
          expect(Math.hypot(p.pos.x - c.link!.spot.pos.x, p.pos.z - c.link!.spot.pos.z), 'they sit where the chair is now').toBeLessThan(.05);
          seen.add(p.id); sat++;
        }
      }
    }
    expect(sat).toBeGreaterThan(0);
  });

  it('nobody is sent to a chair somebody is carrying', () => {
    initDay();
    const chairs = ofType('chair-wood');
    for (const c of chairs) c.carriedBy = 99;
    let sentThere = 0;
    for (let i = 0; i < 20000; i++) {
      stepSim(.05);
      for (const p of people) if (p.task && chairs.some(c => c.id === p.task!.spot.object)) sentThere++;
    }
    expect(sentThere).toBe(0);
    resetAllObjects();
  });

  it('a chair that is carried can be set down and used again', () => {
    initDay();
    const chairs = ofType('chair-wood');
    for (const c of chairs) c.carriedBy = 4;
    run(200); // (a good stretch of the day: nobody is sent to one)
    for (const c of chairs) c.carriedBy = null;
    let used = 0;
    for (let i = 0; i < 12000 && !used; i++) { stepSim(.05); for (const p of people) if (p.task && chairs.some(c => c.id === p.task!.spot.object)) used++; }
    expect(used, 'once they are down, somebody uses them again').toBeGreaterThan(0);
  });

  it('somebody who arrives to find their own chair in somebody\'s hands waits for it, instead of going home for the day', () => {
    initDay();
    const late = people.find(p => p.slot && p.state === 'away' && !isHelper(p))!;
    const chair = objects.all().find(o => o.link?.spot === late.slot)!;
    chair.carriedBy = 7;
    late.arriveAt = sim.t + .2; late.leaveAt = sim.t + 600;
    run(5);
    expect(late.state, 'not sent home').not.toBe('away');
    expect(late.arrivedAt).not.toBeNull();
    chair.carriedBy = null;
    run(5);
    expect(late.state, 'and gets on with the day once the chair is down').not.toBe('away');
    expect(late.task).not.toBeNull();
  });

  it('meetings do not use a conference chair somebody is carrying', () => {
    const conf = objects.all().filter(o => o.link?.spot.kind === 'conf');
    for (const c of conf) c.carriedBy = 8;
    initDay();
    let started = 0;
    for (let i = 0; i < 3 * 60 * 20 * 20 && sim.day === 1; i++) { stepSim(.05); started = Math.max(started, meetings.length); if (started) break; }
    expect(meetings.filter(m => m.members.some(p => p.task?.spot && conf.some(c => c.id === p.task!.spot.object)))).toEqual([]);
    expect(started).toBe(0);
  });
});

describe('what small things stand on', () => {
  it('a desk, anyone\'s, at desk height; nothing between the desks', () => {
    const mug = ofType('mug')[0];
    expect(restHeightAt(mug, mug.x, mug.z)).toBe(DESK_TOP);
    expect(restHeightAt(mug, mug.x, mug.z - 6)).toBeNull();
  });

  it('a chair seat, at seat height: a mug can be put on a chair', () => {
    const mug = ofType('mug')[0], chair = ofType('chair-wood')[0];
    expect(restHeightAt(mug, chair.x, chair.z)).toBeCloseTo(.475, 6);
    expect(placementProblem(mug, chair.x, chair.z, 0)).toBeNull();
  });

  it('not a chair somebody carries, nor one knocked over', () => {
    const mug = ofType('mug')[0], chair = ofType('chair-wood')[0];
    chair.carriedBy = 3;
    expect(restHeightAt(mug, chair.x, chair.z)).toBeNull();
    chair.carriedBy = null;
    setObjectPose(chair, chair.x, chair.z, chair.rot, .2, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    expect(restHeightAt(mug, chair.x, chair.z)).toBeNull();
  });

  it('a fixed top from the layout (a conference table, the counter), at its height; the highest top wins', () => {
    const mug = ofType('mug')[0], [px, py] = toPx({ x: mug.x, z: mug.z - 6 });
    setFixedTops([[px - 10, py - 10, px + 10, py + 10, .96]]);
    expect(restHeightAt(mug, mug.x, mug.z - 6)).toBe(.96);
    setFixedTops([]);
  });

  it('chairs stand on the floor wherever they go', () => {
    const chair = ofType('chair-wood')[0];
    expect(restHeightAt(chair, chair.x + 1, chair.z)).toBe(0);
  });
});

describe('things that carry more than one spot', () => {
  it('every spot moves with it, and it is in use while any of them is', () => {
    const chair = ofType('chair-wood')[0], spare = interactables.all().find(s => s.kind === 'whiteboard')!;
    const o = addObject({ type: 'chair-wood', x: chair.x + 3, z: chair.z, rot: 0, y: 0, variant: 0, station: null, spot: null, spots: [spare.id] });
    const at = { x: spare.pos.x, z: spare.pos.z };
    setObjectPose(o, o.x + 1, o.z, 0);
    expect(spare.pos.x).toBeCloseTo(at.x + 1, 6);
    expect(spare.pos.z).toBeCloseTo(at.z, 6);
    expect(movability(o)).toBeNull();
    spare.occupant = { id: 1 } as never;
    expect(movability(o)).toBe('in-use');
    spare.occupant = null;
  });

  it('a seat cannot be used while its chair is carried or lies knocked over; a slight lean is fine', () => {
    const chair = ofType('chair-wood')[0], seat = chair.link!.spot;
    expect(seatUnusable(seat)).toBe(false);
    chair.carriedBy = 4;
    expect(seatUnusable(seat)).toBe(true);
    chair.carriedBy = null;
    const lean = (deg: number): [number, number, number, number] => [Math.sin(deg * Math.PI / 360), 0, 0, Math.cos(deg * Math.PI / 360)];
    setObjectPose(chair, chair.x, chair.z, chair.rot, 0, lean(5));
    expect(seatUnusable(seat)).toBe(false);
    setObjectPose(chair, chair.x, chair.z, chair.rot, .2, lean(80));
    expect(seatUnusable(seat)).toBe(true);
  });
});
