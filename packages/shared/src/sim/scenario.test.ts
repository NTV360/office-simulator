import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTRY } from './spots';
import { findPath } from '../nav/astar';
import { setSeed } from '../util';
import { simEvents } from './events';
import { initDay } from './day';
import { makeStaff, removeStaff, setStaffCount } from './factory';
import { interactables } from './interactables';
import { hasSlot } from './person';
import { PROP_KEYS } from './props';
import { meetings, people, sim } from './state';
import { screenState, stepSim } from './step';
import { buildTestLayout } from './testing';
import type { Person } from './types';

// The real simulation, run in Node on a small test office, with no browser.

const DT = .05;
const staff = () => people.filter(hasSlot);
const run = (minutes: number) => { const until = sim.t + minutes; while (sim.t < until) stepSim(DT); };
const runUntil = (t: number) => { while (sim.t < t) stepSim(DT); };

function start(seed: number) {
  setSeed(seed);
  buildTestLayout({ desks: 40 });
  initDay();
}

/** Everything that matters about the world, rounded, in a stable order. */
function snapshot() {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return JSON.stringify({
    t: r(sim.t), day: sim.day,
    people: people.map(p => [p.name, p.state, p.task?.kind ?? '', r(p.pos.x), r(p.pos.z), p.shown, PROP_KEYS.filter(k => p.props[k]).join(',')]),
    meetings: meetings.map(m => [m.room, r(m.start), r(m.end), m.members.map(p => p.name).join('|')]),
  });
}

beforeEach(() => simEvents.clear());
afterEach(() => setSeed(null));

describe('the test office', () => {
  it('has a route from the door to every desk', () => {
    setSeed(1);
    buildTestLayout({ desks: 40 });
    for (const desk of interactables.of('desk')) expect(findPath(ENTRY, desk.approach), desk.id).not.toBeNull();
  });
});

describe('a seeded day', () => {
  it('starts mid-morning with 40 staff, most already at work', () => {
    start(1);
    expect(staff()).toHaveLength(40);
    expect(staff().filter(p => p.state !== 'away').length).toBeGreaterThan(30);
    expect(new Set(staff().map(p => p.slot)).size).toBe(40); // everyone has their own desk
    expect(staff()[0].name).toBe('Hazel Sellote');
  });

  it('everyone has arrived and is busy by early afternoon, and nobody sits on someone else\'s desk', () => {
    start(1);
    runUntil(13 * 60);
    for (const p of staff()) {
      expect(p.arrivedAt, p.name + ' arrived').not.toBeNull();
      expect(['walking', 'doing'], p.name + ' is busy').toContain(p.state);
      expect(p.task, p.name + ' has something to do').not.toBeNull();
    }
    for (const desk of interactables.of('desk')) {
      const here = staff().filter(p => p.state === 'doing' && p.task?.spot === desk);
      expect(here.every(p => p.slot === desk), desk.id).toBe(true);
    }
  });

  it('meetings start, have people in them, and end', () => {
    start(1);
    const seen: Array<{ room: number; members: Person[] }> = [];
    const known = new Set<object>();
    while (sim.t < 18 * 60 && sim.day === 1) { // (a meeting that starts at 17:10 can run until 17:55)
      stepSim(DT);
      for (const m of meetings) if (!known.has(m)) { known.add(m); seen.push({ room: m.room, members: m.members.slice() }); }
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const m of seen) expect(m.members.length).toBeGreaterThanOrEqual(2);
    expect(meetings).toHaveLength(0);
    expect(staff().every(p => !p.meeting)).toBe(true);
  });

  it('nobody is stuck: all day, anyone walking keeps getting closer to their goal', () => {
    start(2);
    const last = new Map<Person, { task: unknown; dist: number }>();
    let samples = 0, tasksSeen = new Set<string>();
    for (let i = 0; sim.day === 1; i++) {
      stepSim(DT);
      if (i % 50) continue; // look once every 50 steps (1 sim minute)
      for (const p of staff()) {
        if (p.state !== 'walking' || !p.path || !p.task) { last.delete(p); continue; }
        const goal = p.path[p.path.length - 1];
        const dist = Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z);
        const prev = last.get(p);
        if (prev && prev.task === p.task) {
          // gentle avoidance may nudge a walker a little off line, but never far from making progress
          expect(dist, p.name + ' walking to ' + p.task.kind + ' is not getting closer').toBeLessThanOrEqual(prev.dist + 0.3);
          expect(dist, p.name + ' made no progress in a minute').not.toBeCloseTo(prev.dist, 6);
        }
        last.set(p, { task: p.task, dist });
        samples++; tasksSeen.add(p.task.kind);
      }
    }
    expect(samples).toBeGreaterThan(200);
    expect(tasksSeen.size).toBeGreaterThan(4); // arrivals, coffee, lunch, meetings, going home...
  });

  it('props follow the task, all day: the right thing in hand while doing it, nothing while away or at a desk', () => {
    start(3);
    const HELD: Record<string, string> = { coffee: 'mug', bar: 'mug', phone: 'phone', golf: 'putter', game: 'pad', guitar: 'guitar' };
    const seenHeld = new Set<string>();
    for (let i = 0; sim.day === 1; i++) {
      stepSim(DT);
      if (i % 20) continue;
      for (const p of staff()) {
        const holding = PROP_KEYS.filter(k => p.props[k]);
        if (p.state === 'away' || p.task?.kind === 'work') expect(holding, p.name + ' at ' + (p.task?.kind ?? 'away')).toEqual([]);
        if (p.state === 'doing' && p.task && HELD[p.task.kind]) { expect(holding, p.name + ' during ' + p.task.kind).toEqual([HELD[p.task.kind]]); seenHeld.add(p.task.kind); }
      }
    }
    expect([...seenHeld].sort()).toEqual(expect.arrayContaining(['coffee', 'phone']));
    expect(seenHeld.size).toBeGreaterThanOrEqual(4);
  });

  it('screens: an empty desk is off, a working person shows their own picture', () => {
    start(1);
    run(30);
    let working = 0;
    for (const desk of interactables.of('desk')) {
      const owner = desk.owner as Person;
      const s = screenState(desk);
      if (owner.state === 'away') expect(s).toBe('off');
      else if (owner.state === 'doing' && owner.task?.spot === desk && owner.task.kind === 'work') { working++; expect(s).toBe(owner.screenKind + ':' + owner.screenVariant); }
      else expect(s).toBe('lock');
    }
    expect(working).toBeGreaterThan(5);
  });

  it('the day rolls over: everyone goes home, then gets a new schedule', () => {
    start(1);
    while (sim.day === 1) stepSim(DT); // the clock jumps back to the morning at 19:10
    expect(sim.day).toBe(2);
    expect(sim.t).toBeLessThan(8 * 60);
    for (const p of staff()) {
      expect(p.state).toBe('away');
      expect(p.shown).toBe(false);
      expect(p.arrivedAt).toBeNull();
      expect(p.task).toBeNull();
      expect(p.arriveAt).toBeGreaterThanOrEqual(7 * 60 + 50);
    }
    expect(meetings).toHaveLength(0);
    run(120); // and the next morning they come back in
    expect(staff().filter(p => p.state !== 'away').length).toBeGreaterThan(20);
  });

  it('Hazel is the last one out: nobody has a later leaving time than hers, and at 19:09 anyone still here is only finishing a work session or already walking out', () => {
    start(1);
    const hazel = staff().find(p => p.name === 'Hazel Sellote')!;
    expect(hazel.leaveAt).toBe(19 * 60 + 2);
    for (const p of staff()) expect(p.leaveAt).toBeLessThanOrEqual(hazel.leaveAt);
    runUntil(19 * 60 + 9);
    expect(sim.day).toBe(1);
    // (someone in the middle of a long work session when their time comes finishes it before going home)
    for (const p of staff().filter(q => q !== hazel && q.state !== 'away')) expect(['work', 'exit'], p.name).toContain(p.task?.kind);
  });
});

describe('repeatability', () => {
  it('the same seed gives the same day, step for step', () => {
    start(7); run(240); const a = snapshot();
    start(7); run(240); const b = snapshot();
    expect(b).toBe(a);
  });
  it('a different seed gives a different day', () => {
    start(7); run(240); const a = snapshot();
    start(8); run(240); const b = snapshot();
    expect(b).not.toBe(a);
  });
});

describe('the built package', () => {
  const dist = path.resolve(__dirname, '../../dist/index.cjs');
  it.skipIf(!fs.existsSync(dist))('runs the same seeded day as the source (what the server will import)', () => {
    const built = createRequire(import.meta.url)(dist);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const run = (api: { setSeed(n: number | null): void; buildTestLayout(o: object): void; initDay(): void; stepSim(dt: number): void; people: Person[]; sim: { t: number } }) => {
      api.setSeed(11); api.buildTestLayout({ desks: 40 }); api.initDay();
      for (let i = 0; i < 6000; i++) api.stepSim(DT);
      return JSON.stringify([r(api.sim.t), api.people.map(p => [p.name, p.state, r(p.pos.x), r(p.pos.z)])]);
    };
    const fromBuilt = run(built);
    setSeed(11); buildTestLayout({ desks: 40 }); initDay();
    for (let i = 0; i < 6000; i++) stepSim(DT);
    const fromSource = JSON.stringify([r(sim.t), people.map(p => [p.name, p.state, r(p.pos.x), r(p.pos.z)])]);
    expect(fromBuilt).toBe(fromSource);
  });
});

describe('slots', () => {
  it('removing staff frees their desk for the next person, and tells listeners', () => {
    start(1);
    const added: string[] = [], removed: string[] = [];
    simEvents.on('personAdded', p => added.push(p.name));
    simEvents.on('personRemoved', p => removed.push(p.name));
    const last = staff()[staff().length - 1];
    const desk = last.slot!;
    expect(removeStaff()).toBe(last);
    expect(desk.owner).toBeNull();
    expect(staff()).toHaveLength(39);
    const again = makeStaff()!;
    expect(again.slot).toBe(desk);
    expect(desk.owner).toBe(again);
    expect(removed).toEqual([last.name]);
    expect(added).toEqual([again.name]);
  });

  it('with every desk taken, no more staff can be made; removing all leaves the office empty', () => {
    start(1);
    expect(makeStaff()).toBeNull();
    while (removeStaff());
    expect(people).toHaveLength(0);
    expect(interactables.of('desk').every(d => !d.owner)).toBe(true);
  });

  it('a human-controlled person is never removed with the staff, and the simulation leaves them alone', () => {
    start(1);
    const you = { id: -1, name: 'You', role: 'You', controller: 'account', state: 'controlled', pos: ENTRY.clone(), face: 0, faceGoal: 2, animT: 0, shown: true } as unknown as Person;
    people.push(you);
    run(60);
    expect(you.state).toBe('controlled');
    expect(you.pos.x).toBe(ENTRY.x);
    expect([you.face, you.animT]).toEqual([0, 0]); // not turned or animated by the simulation
    while (removeStaff());
    expect(people).toEqual([you]);
  });
});

describe('setStaffCount', () => {
  it('adds and removes staff up to the number of desks, and reports the result', () => {
    start(1);
    expect(setStaffCount(25)).toBe(25);
    expect(setStaffCount(33)).toBe(33);
    expect(staff()).toHaveLength(33);
    expect(setStaffCount(10)).toBe(10);
    expect(interactables.of('desk').filter(d => d.owner)).toHaveLength(10);
    expect(setStaffCount(5000)).toBe(40); // the test office has 40 desks
    expect(setStaffCount(-3)).toBe(0);
    expect(setStaffCount(NaN)).toBe(0);
  });
  it('someone added during the working day turns up within a few minutes', () => {
    start(1);
    setStaffCount(38); // free two desks, then add them back at 9:25
    const before = new Set(staff());
    setStaffCount(40);
    const added = staff().filter(p => !before.has(p));
    expect(added).toHaveLength(2);
    for (const p of added) expect(p.arriveAt - sim.t).toBeLessThan(4.1);
  });
  it('leaves a human-controlled person alone', () => {
    start(1);
    const you = { id: -1, name: 'You', role: 'You', controller: 'account', state: 'controlled', pos: ENTRY.clone() } as unknown as Person;
    people.push(you);
    setStaffCount(0);
    expect(people).toEqual([you]);
  });
});
