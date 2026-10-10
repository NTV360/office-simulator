import { beforeEach, describe, expect, it } from 'vitest';
import { OX, OY, S } from '../plan';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { walkPx } from '../nav/grid';
import { setSeed } from '../util';
import { initDay } from './day';
import {
  RUN_SPEED, SEAT_REACH, WALK_SPEED, isSeated, nearestSeat, sanitizeInput, seatOK, sit, stand, stepAllDriven, stepDriven, type DrivenInput,
} from './driven';
import { initGrid } from '../nav/grid';
import { goDo } from './tasks';
import { interactables } from './interactables';
import { ENTRY, mkSpot } from './spots';
import { initState, people, resetSim, sim } from './state';
import { stepSim } from './step';
import { makeGuest, takeControl } from './takeover';
import { buildTestLayout } from './testing';
import type { Person } from './types';

// Phase 3, step 4, the simulation half: how a person a human drives moves and sits.

const DT = 0.05;
const input = (over: Partial<DrivenInput> = {}): DrivenInput => ({ seq: 1, mx: 0, mz: 1, heading: 0, run: false, tick: 0, ...over });
/** Drive a person with the same input for `seconds`, one tick at a time; returns the distance moved. */
function drive(p: Person, i: Partial<DrivenInput>, seconds: number, startTick = 0): number {
  let total = 0;
  for (let n = 0; n < Math.round(seconds / DT); n++) {
    const tick = startTick + n;
    total += stepDriven(p, input({ ...i, tick }), DT, tick, people);
  }
  return total;
}
const at = (p: Person) => ({ x: p.pos.x, z: p.pos.z });

describe('sanitizeInput', () => {
  it('keeps a good input as it is', () => {
    expect(sanitizeInput({ seq: 5, mx: 0.5, mz: -0.5, heading: 1, run: true }, 9)).toEqual({ seq: 5, mx: 0.5, mz: -0.5, heading: 1, run: true, tick: 9 });
  });
  it('refuses anything that is not an input, or has numbers that are not numbers', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { seq: 1, mx: NaN, mz: 0, heading: 0 }, { seq: 1, mx: 0, mz: Infinity, heading: 0 }, { seq: '1', mx: 0, mz: 0, heading: 0 }, { seq: 1, mx: 0, mz: 0, heading: null }, { seq: 1, mx: 0, mz: 0 }]) {
      expect(sanitizeInput(bad, 0), JSON.stringify(bad)).toBeNull();
    }
  });
  it('never allows a direction longer than 1, however big the numbers', () => {
    for (const [mx, mz] of [[5, 5], [1e30, -1e30], [3, 0], [-0.8, 0.8], [1, 1]]) {
      const i = sanitizeInput({ seq: 1, mx, mz, heading: 0 }, 0)!;
      expect(Math.hypot(i.mx, i.mz)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
  it('turns the heading into one turn and treats "run" as true only when it is exactly true', () => {
    expect(sanitizeInput({ seq: 1, mx: 0, mz: 0, heading: 7 }, 0)!.heading).toBeCloseTo(7 - 2 * Math.PI, 9);
    expect(sanitizeInput({ seq: 1, mx: 0, mz: 0, heading: -1 }, 0)!.heading).toBeCloseTo(2 * Math.PI - 1, 9);
    expect(sanitizeInput({ seq: 1, mx: 0, mz: 0, heading: 0, run: 'yes' }, 0)!.run).toBe(false);
    expect(sanitizeInput({ seq: 1, mx: 0, mz: 0, heading: 0, run: true }, 0)!.run).toBe(true);
  });
});

describe('moving', () => {
  beforeEach(() => { setSeed(1); buildTestLayout({ desks: 40 }); initDay(); for (const p of people) p.state = 'away'; }); // (nobody else is in the way)
  const driven = () => { const p = makeGuest(1, 'tester'); p.pos.x = 0.5; p.pos.z = 0.5; return p; };
  // (the test office is open floor, so walking the first few metres from the entrance is never blocked)
  const startOnFloor = (p: Person) => { const d = interactables.of('desk')[0]; p.pos.x = d.pos.x + 3; p.pos.z = d.pos.z + 3; };

  it('walks at 1.5 m/s and runs at 3 m/s', () => {
    const p = driven(); startOnFloor(p);
    const walked = drive(p, { mx: 0, mz: 1 }, 1);
    expect(walked).toBeCloseTo(WALK_SPEED, 6);
    expect(drive(p, { mx: 0, mz: -1, run: true }, 1)).toBeCloseTo(RUN_SPEED, 6);
  });

  it('half a stick is half the speed, and a diagonal is no faster than straight', () => {
    const p = driven(); startOnFloor(p);
    expect(drive(p, { mx: 0, mz: 0.5 }, 1)).toBeCloseTo(WALK_SPEED / 2, 6);
    expect(drive(p, { mx: 1, mz: 1 }, 1)).toBeCloseTo(WALK_SPEED, 6); // (clamped to length 1 when sanitised)
  });

  it('the cap holds whatever is sent: a million times the speed is still the speed', () => {
    const p = driven(); startOnFloor(p);
    let worst = 0;
    for (let n = 0; n < 400; n++) {
      const i = sanitizeInput({ seq: n, mx: (Math.sin(n) * 1e6), mz: (Math.cos(n * 3) * 1e6), heading: n, run: true }, n)!;
      worst = Math.max(worst, stepDriven(p, i, DT, n, people));
    }
    expect(worst).toBeLessThanOrEqual(RUN_SPEED * DT + 1e-9);
  });

  it('a resting thumb (tiny stick) does nothing, but the heading still turns them', () => {
    const p = driven(); startOnFloor(p);
    const where = at(p);
    stepDriven(p, input({ mx: 0.05, mz: 0.02, heading: 2 }), DT, 0, people);
    expect(at(p)).toEqual(where);
    expect(p.face).toBeCloseTo(2, 9);
  });

  it('moves in the direction asked and faces the heading', () => {
    const p = driven(); startOnFloor(p);
    const from = at(p);
    drive(p, { mx: 1, mz: 0, heading: 1.25 }, 1);
    expect(p.pos.x - from.x).toBeCloseTo(WALK_SPEED, 6);
    expect(p.pos.z).toBeCloseTo(from.z, 9);
    expect(p.face).toBeCloseTo(1.25, 9);
    expect(p.walkPhase).toBeGreaterThan(5); // legs swing in step with distance
  });

  it('stops when the input goes stale (the player stopped sending), within a quarter of a second', () => {
    const p = driven(); startOnFloor(p);
    stepDriven(p, input({ tick: 0 }), DT, 0, people);
    let moved = 0;
    for (let tick = 1; tick <= 12; tick++) moved += stepDriven(p, input({ tick: 0 }), DT, tick, people); // the same old input, never refreshed
    expect(moved).toBeCloseTo(5 * WALK_SPEED * DT, 6); // five more ticks of grace, then still
    expect(stepDriven(p, input({ tick: 0 }), DT, 99, people)).toBe(0);
  });

  it('no input at all means no movement', () => {
    const p = driven(); startOnFloor(p);
    const where = at(p);
    stepDriven(p, null, DT, 5, people);
    expect(at(p)).toEqual(where);
  });

  it('walls and furniture hold: on the real office, walking into the outer wall for a minute never leaves the floor', () => {
    resetSim(); loadLayout(officeLayout); initState();
    const p = makeGuest(1, 'tester');
    for (const [mx, mz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      for (let n = 0; n < 1200; n++) stepDriven(p, input({ mx, mz, run: true, tick: n }), DT, n, people);
      expect(walkPx(p.pos.x / S + OX, p.pos.z / S + OY), `after walking (${mx}, ${mz})`).toBe(true);
    }
  });

  it('is pushed out of anyone it walks into (no standing inside someone)', () => {
    const p = driven(); startOnFloor(p);
    const other = people[0];
    other.state = 'doing'; other.pos.x = p.pos.x + 0.1; other.pos.z = p.pos.z;
    stepDriven(p, input({ mx: 0, mz: 0, tick: 0 }), DT, 0, people); // standing still does not push
    drive(p, { mx: 1, mz: 0 }, 0.1);
    expect(Math.hypot(p.pos.x - other.pos.x, p.pos.z - other.pos.z)).toBeGreaterThan(0.1);
  });
});

describe('sitting', () => {
  beforeEach(() => { setSeed(1); buildTestLayout({ desks: 40 }); initDay(); });
  let next = 0;
  /** A seat of our own on open floor, a few metres from every other, so which one is nearest is never in doubt. */
  const seatAt = (kind: string, opts: { sit?: boolean; shared?: boolean; group?: string } = {}) => { const x = 380 + (next % 6) * 45, y = 380 + Math.floor(next / 6) * 45; next++; return mkSpot(kind, x, y, 1.5, { sit: true, ...opts }); };
  const guestAt = (x: number, z: number) => { const g = makeGuest(1, 'g'); g.pos.x = x; g.pos.z = z; return g; };
  const near = (s: { pos: { x: number; z: number } }, dx = 0.1) => guestAt(s.pos.x + dx, s.pos.z);

  it('takes the nearest free seat within reach, and puts them in it facing the way it faces', () => {
    const seat = seatAt('lounge');
    const g = near(seat, 0.4);
    expect(nearestSeat(g)).toBe(seat);
    expect(sit(g)).toBe(true);
    expect([g.pos.x, g.pos.z, g.face]).toEqual([seat.pos.x, seat.pos.z, seat.face]);
    expect([isSeated(g), seat.occupant]).toEqual([true, g]);
    expect(g.task).toMatchObject({ kind: 'playerSit', spot: seat });
  });

  it('nothing is near enough: nothing happens', () => {
    const g = guestAt(ENTRY.x, ENTRY.z + 40);
    expect(nearestSeat(g)).toBeNull();
    expect(sit(g)).toBe(false);
    expect(isSeated(g)).toBe(false);
  });

  it('just inside and just outside the reach', () => {
    const seat = seatAt('lounge');
    expect(nearestSeat(guestAt(seat.pos.x + SEAT_REACH - 0.01, seat.pos.z))).toBe(seat);
    expect(nearestSeat(guestAt(seat.pos.x + SEAT_REACH + 0.01, seat.pos.z))).toBeNull();
  });

  it('of two seats the nearer one is taken', () => {
    const first = seatAt('lounge');
    const second = mkSpot('lounge', (first.pos.x / S + OX) + 24, first.pos.z / S + OY, 0, { sit: true }); // 24 plan pixels (about a metre) along
    const nearFirst = guestAt(first.pos.x + 0.3, first.pos.z), nearSecond = guestAt(second.pos.x - 0.3, second.pos.z);
    expect(nearestSeat(nearFirst)).toBe(first);
    expect(nearestSeat(nearSecond)).toBe(second);
  });

  it('two people cannot sit in one shared seat: the second is refused', () => {
    const seat = seatAt('lounge');
    const a = near(seat, 0.2), b = near(seat, -0.2);
    expect(sit(a)).toBe(true);
    expect(seatOK(seat, b)).toBe(false);
    expect(nearestSeat(b)).toBeNull();
    expect(sit(b)).toBe(false);
    expect(seat.occupant).toBe(a);
  });

  it('sitting twice does nothing the second time', () => {
    const seat = seatAt('lounge');
    const g = near(seat, 0);
    expect(sit(g)).toBe(true);
    expect(sit(g)).toBe(false);
  });

  it('a desk is only for its owner, or anyone while its owner is away', () => {
    const desk = interactables.of('desk').find(d => (d.owner as Person)?.state === 'doing')!;
    const g = guestAt(desk.pos.x + 0.3, desk.pos.z);
    expect(seatOK(desk, g)).toBe(false);
    (desk.owner as Person).state = 'away';
    expect(seatOK(desk, g)).toBe(true);
    const owner = desk.owner as Person;
    takeControl(owner);
    expect(seatOK(desk, owner)).toBe(true);
  });

  it('standing up puts them at the seat approach point and clears the seat and what they held', () => {
    const seat = seatAt('bar');
    const g = near(seat, 0);
    sit(g);
    expect(g.props.mug).toBe(true); // a bar stool: coffee in hand
    g.pos.x += 0; // (sitting put them on the seat)
    expect(stand(g)).toBe(true);
    expect([g.pos.x, g.pos.z]).toEqual([seat.approach.x, seat.approach.z]);
    expect([g.props.mug, g.task, seat.occupant]).toEqual([false, null, null]);
    expect(stand(g)).toBe(false); // not sitting any more
  });

  it('the seat decides the pose and what is held', () => {
    const cases: Array<[string, string, string?, string?]> = [['booth', 'phone', 'phone'], ['bar', 'drinkSit', 'mug'], ['piano', 'piano', undefined, 'music'], ['guitar', 'guitar', 'guitar', 'music'], ['conf', 'listenSit'], ['dining', 'listenSit']];
    for (const [kind, anim, prop, group] of cases) {
      const seat = seatAt(kind, group ? { group } : {});
      const g = near(seat, 0);
      expect(sit(g), kind).toBe(true);
      expect(g.task!.anim, kind).toBe(anim);
      if (prop) expect((g.props as Record<string, boolean>)[prop], kind).toBe(true);
      stand(g);
    }
    const game = seatAt('lounge'); game.game = true;
    const g = near(game, 0);
    sit(g);
    expect([g.task!.anim, g.props.pad]).toEqual(['game', true]);
  });

  it('moving gets them out of the chair first, and then they walk', () => {
    const seat = seatAt('lounge');
    const g = near(seat, 0);
    sit(g);
    const moved = stepDriven(g, input({ mx: 1, mz: 0, tick: 0 }), DT, 0, people);
    expect(isSeated(g)).toBe(false);
    expect(seat.occupant).toBeNull();
    expect(moved).toBeGreaterThan(0);
  });

  it('staying still in the chair keeps them in it, facing the seat', () => {
    const seat = seatAt('lounge');
    const g = near(seat, 0);
    sit(g);
    for (let n = 0; n < 40; n++) stepDriven(g, input({ mx: 0, mz: 0, heading: 3, tick: n }), DT, n, people);
    expect(isSeated(g)).toBe(true);
    expect(g.face).toBe(seat.face);
  });

  it('a seat a human holds is not taken by the simulation for a long while', () => {
    const seat = seatAt('lounge');
    const g = near(seat, 0);
    sit(g);
    const until = sim.t + 90;
    while (sim.t < until) { stepSim(DT); expect(seat.occupant).toBe(g); }
  });
});

describe('review fixes', () => {
  beforeEach(() => { setSeed(1); buildTestLayout({ desks: 40 }); initDay(); });
  const guestAt = (x: number, z: number) => { const g = makeGuest(1, 'g'); g.pos.x = x; g.pos.z = z; return g; };

  it('two humans cannot sit at the same unowned desk, and an owner does not walk onto a desk a human is at', () => {
    const desk = mkSpot('desk', 450, 450, 0, { sit: true, shared: false });
    const a = guestAt(desk.pos.x + 0.2, desk.pos.z), b = guestAt(desk.pos.x - 0.2, desk.pos.z);
    expect(sit(a)).toBe(true);
    expect(desk.occupant).toBe(a);
    expect(seatOK(desk, b)).toBe(false);
    expect(sit(b)).toBe(false);
    const owner = people.find(p => p.controller === 'ai')!;
    expect(goDo(owner, { kind: 'work', cat: 'work', anim: 'type', spot: desk, dur: 5 })).toBe(false); // the simulation waits
    stand(a);
    expect(desk.occupant).toBeNull();
  });

  it('a person the simulation drives cannot sit in a seat: only a human can', () => {
    const seat = mkSpot('lounge', 450, 500, 0, { sit: true });
    const ai = people.find(p => p.controller === 'ai')!;
    ai.pos.x = seat.pos.x; ai.pos.z = seat.pos.z;
    expect(sit(ai)).toBe(false);
  });

  it('a seat behind a wall is not in reach, even a metre away', () => {
    const seat = mkSpot('lounge', 450, 450, 0, { sit: true });
    const g = guestAt(seat.pos.x + 1.0, seat.pos.z);
    expect(nearestSeat(g)).toBe(seat);
    const wall = (seat.pos.x + 0.5) / S + OX; // plan pixels, half a metre from the seat on the person's side
    initGrid([[wall - 3, 0, wall + 3, 5000]]); // a long wall between them
    expect(nearestSeat(g)).toBeNull();
    initGrid([]);
    expect(nearestSeat(g)).toBe(seat);
  });

  it('a slow tick (long steps) cannot jump over a thin wall', () => {
    const g = guestAt(0, 0);
    const start = interactables.of('desk')[0];
    g.pos.x = start.pos.x + 3; g.pos.z = start.pos.z + 3;
    const wallX = g.pos.x + 1.5, px = wallX / S + OX;
    initGrid([[px - 1, 0, px + 1, 5000]]); // a wall about half a metre thick with the margin
    for (let n = 0; n < 6; n++) stepDriven(g, input({ mx: 1, mz: 0, run: true, tick: n }), 0.5, n, people, 5); // 1.5 m per step
    expect(g.pos.x).toBeLessThan(wallX);
    initGrid([]);
  });

  it('an input from the future (after a world reset) is not believed', () => {
    const g = guestAt(0, 0);
    const start = interactables.of('desk')[0];
    g.pos.x = start.pos.x + 3; g.pos.z = start.pos.z + 3;
    const where = at(g);
    stepDriven(g, input({ mx: 1, mz: 0, tick: 5000 }), DT, 3, people);
    expect(at(g)).toEqual(where);
  });

  it('how long an input is believed is a quarter of a second at any tick rate', () => {
    const g = guestAt(0, 0);
    const start = interactables.of('desk')[0];
    g.pos.x = start.pos.x + 3; g.pos.z = start.pos.z + 3;
    const inputs = new Map<number, DrivenInput>([[g.id, input({ mx: 1, mz: 0, tick: 0 })]]);
    let steps = 0;
    for (let tick = 0; tick < 100; tick++) { const before = g.pos.x; stepAllDriven(inputs, 0.1, tick); if (g.pos.x > before) steps++; } // a 10 Hz server
    expect(steps).toBe(4); // ticks 0 to 3: 0.3 s, the first whole number of ticks past a quarter of a second
  });
});

describe('everyone a human drives', () => {
  beforeEach(() => { setSeed(2); buildTestLayout({ desks: 40 }); initDay(); });

  it('is moved by their own input and nobody else is', () => {
    const a = makeGuest(1, 'a'), b = makeGuest(2, 'b');
    a.pos.x = b.pos.x = interactables.of('desk')[0].pos.x + 3; a.pos.z = b.pos.z = interactables.of('desk')[0].pos.z + 3;
    const inputs = new Map<number, DrivenInput>([[a.id, input({ mx: 1, mz: 0, tick: 0 })]]);
    const ai = people.find(p => p.controller === 'ai' && p.state === 'doing')!;
    const aiAt = at(ai), bAt = at(b);
    stepAllDriven(inputs, DT, 0);
    expect(at(b)).toEqual(bAt); // no input: still
    expect(at(ai)).toEqual(aiAt); // not driven by a human: untouched here
    expect(a.pos.x).toBeGreaterThan(aiAt.x - 100);
    expect(a.walkPhase).toBeGreaterThan(0);
  });

  it('a human-driven person never gets a task from the simulation over a long stretch of time', () => {
    const g = makeGuest(1, 'g');
    const inputs = new Map<number, DrivenInput>();
    for (let n = 0; n < 6000; n++) { stepAllDriven(inputs, DT, n); stepSim(DT); }
    expect([g.state, g.task]).toEqual(['controlled', null]);
  });
});
