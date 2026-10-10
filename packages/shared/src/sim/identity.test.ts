import { beforeEach, describe, expect, it } from 'vitest';
import { Vec3 } from '../vec3';
import { setSeed } from '../util';
import { ENTRY } from './spots';
import { initDay, newDay } from './day';
import { makeStaff, removeStaff, setStaffCount } from './factory';
import { hasSlot, isAi, isDriven } from './person';
import { SAVE_VERSION, SaveError, parseSavedWorld, restoreWorld, serializeWorld } from './persist';
import { allocatePersonId, meetings, people, sim } from './state';
import { stepSim } from './step';
import { buildTestLayout, removeHelper } from './testing';
import type { Person } from './types';

// Phase 3, step 0: who a person is, how they are told apart, and what the save remembers about them.

beforeEach(() => { setSeed(1); buildTestLayout({ desks: 40 }); initDay(); removeHelper(); }); // (these tests count everyone: the helper is tested on her own)

/** What step 3 will do when an account takes over a person (done by hand here). */
const claim = (p: Person, account: number) => { p.owner = account; };
const takeOver = (p: Person) => { p.controller = 'account'; p.state = 'controlled'; p.task = null; p.path = null; };
const guest = (account: number): Person => {
  const g = {
    id: allocatePersonId(), name: 'Guest', role: 'Guest', controller: 'account', owner: account, state: 'controlled', shown: true,
    pos: new Vec3(ENTRY.x, 0, ENTRY.z), face: 0, faceGoal: 0, props: { mug: false, phone: false, pad: false, guitar: false, putter: false, bucket: false, rag: false, mop: false },
    task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: 0, animT: 0, pose: {}, arriveAt: 0, leaveAt: 0, lunchAt: 0, hadLunch: false,
    arrivedAt: null, coffees: 0, chatWith: null, meeting: null, screenKind: 'code', screenVariant: 0, speed: 1.3, spec: {} as Person['spec'],
  } as Person;
  people.push(g);
  return g;
};

describe('ids', () => {
  it('start at zero, are all different, and the lowest free one is reused after someone leaves', () => {
    expect(people.map(p => p.id)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    setStaffCount(35);
    expect(allocatePersonId()).toBe(35);
    setStaffCount(40);
    expect(new Set(people.map(p => p.id)).size).toBe(40);
  });

  it('never collide, whatever mix of staff and guests comes and goes', () => {
    setStaffCount(10);
    const guests: Person[] = [];
    let seed = 7; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 400; i++) {
      const r = rand();
      if (r < 0.3) guests.push(guest(100 + i));
      else if (r < 0.5 && guests.length) { const g = guests.splice(Math.floor(rand() * guests.length), 1)[0]; people.splice(people.indexOf(g), 1); }
      else if (r < 0.75) setStaffCount(people.filter(hasSlot).length + 1);
      else setStaffCount(Math.max(0, people.filter(hasSlot).length - 1));
      const ids = people.map(p => p.id);
      expect(new Set(ids).size, `after step ${i}`).toBe(ids.length);
      expect(Math.max(...ids)).toBeLessThan(80); // ids stay about as small as the biggest the crowd has been, far below the protocol limit
    }
  });

  it('a player never takes a staff id, even though they are not counted as staff', () => {
    const g = guest(5);
    expect(g.id).toBe(40);
    const p = makeStaff();
    expect(p).toBeNull(); // no free desk in the 40-desk test office
    setStaffCount(30);
    const again = guest(6);
    expect(new Set(people.map(q => q.id)).size).toBe(people.length);
    expect(again.id).toBe(30);
  });
});

describe('the three questions', () => {
  it('ask different things of the same people', () => {
    const owned = people[3], plain = people[4], g = guest(9);
    claim(owned, 1); takeOver(owned);
    expect([isAi(plain), hasSlot(plain), isDriven(plain)]).toEqual([true, true, false]);   // unclaimed NPC
    expect([isAi(owned), hasSlot(owned), isDriven(owned)]).toEqual([false, true, true]);   // an owner who is online
    expect([isAi(g), hasSlot(g), isDriven(g)]).toEqual([false, false, true]);              // a guest
    owned.controller = 'ai'; owned.state = 'idle';
    expect([isAi(owned), hasSlot(owned), isDriven(owned)]).toEqual([true, true, false]);   // the same owner, offline, on autopilot
  });
});

describe('slots', () => {
  it('removing slots never removes a person who belongs to an account', () => {
    const owned = [people[39], people[38], people[10]];
    owned.forEach((p, i) => claim(p, i + 1));
    expect(setStaffCount(0)).toBe(3);
    expect(people.filter(hasSlot)).toHaveLength(3);
    expect(people.filter(hasSlot).every(p => p.owner !== undefined)).toBe(true);
    expect(removeStaff()).toBeNull();
    expect(setStaffCount(20)).toBe(20); // and can be raised again
  });

  it('a person someone is driving is not removed either, nor is a guest counted as a slot', () => {
    const p = people[39]; claim(p, 1); takeOver(p);
    guest(2);
    expect(setStaffCount(0)).toBe(1);
    expect(people.filter(hasSlot)).toEqual([p]);
    expect(people).toHaveLength(2);
  });

  it('only unclaimed people are removed first, the most recent of them', () => {
    claim(people[39], 1);
    removeStaff();
    expect(people.some(p => p.id === 39)).toBe(true);
    expect(people.some(p => p.id === 38)).toBe(false);
  });
});

describe('what the simulation does to each kind', () => {
  it('a day ends for autopilot people, owned or not, but not for a person a human is driving', () => {
    const owned = people[5], driven = people[6];
    claim(owned, 1);
    claim(driven, 2); takeOver(driven);
    driven.shown = true; driven.pos = new Vec3(3, 0, 4);
    const g = guest(3);
    while (sim.day === 1) stepSim(.05);
    expect(owned.state).toBe('away');                 // claimed but on autopilot: goes home like everyone
    expect(driven.state).toBe('controlled');          // the owner is online: never sent home
    expect(driven.shown).toBe(true);
    expect(driven.pos.x).toBe(3);
    expect(g.state).toBe('controlled');
  });

  it('meetings are only ever made of autopilot people', () => {
    people.filter(hasSlot).slice(0, 12).forEach((p, i) => { claim(p, i + 1); takeOver(p); });
    const before = new Set(meetings); // the two that initDay started, before anyone was taken over
    let made = 0;
    for (let i = 0; i < 20000; i++) {
      stepSim(.05);
      for (const m of meetings) if (!before.has(m)) { made++; for (const member of m.members) expect(isAi(member)).toBe(true); }
    }
    expect(made).toBeGreaterThan(1);
    for (const p of people.filter(isDriven)) expect(p.state).toBe('controlled');
  });
});

describe('the save remembers owners, and still reads old saves', () => {
  const via = () => JSON.parse(JSON.stringify(serializeWorld()));

  it('is version 2 and records who owns which person', () => {
    claim(people[7], 42); claim(people[8], 7);
    const saved = via();
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.people[7].owner).toBe(42);
    expect(saved.people[8].owner).toBe(7);
    expect(saved.people[9].owner).toBeNull();
  });

  it('restores owners; a person who was online comes back on autopilot; guests are not saved', () => {
    claim(people[7], 42); takeOver(people[7]);
    people[7].pos = new Vec3(5, 0, 6);
    guest(9);
    const saved = via();
    expect(saved.people).toHaveLength(40);           // the guest is not in the save
    restoreWorld(parseSavedWorld(saved));
    const back = people.find(p => p.owner === 42)!;
    expect(back.id).toBe(7);
    expect(back.controller).toBe('ai');              // nobody is online after a restart
    expect([back.state, back.shown, back.pos.x, back.pos.z]).toEqual(['idle', true, 5, 6]);
    expect(people.filter(p => p.owner !== undefined)).toHaveLength(1);
    expect(people.filter(hasSlot)).toHaveLength(40);
    expect(people).toHaveLength(40);
  });

  it('owners and ids survive restore, save, restore again', () => {
    claim(people[2], 11); claim(people[30], 12);
    restoreWorld(parseSavedWorld(via()));
    const again = via();
    restoreWorld(parseSavedWorld(again));
    expect(via()).toEqual(again);
    expect(people.map(p => [p.id, p.owner ?? null]).filter(x => x[1] !== null)).toEqual([[2, 11], [30, 12]]);
  });

  it('reads a version 1 save (no owners, no field) as a world with no owners', () => {
    const v1 = via();
    v1.version = 1;
    for (const p of v1.people) delete p.owner;
    const parsed = parseSavedWorld(v1);
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.people.every(p => p.owner === null)).toBe(true);
    restoreWorld(parsed);
    expect(people.filter(p => p.owner !== undefined)).toHaveLength(0);
    expect(people).toHaveLength(40);
  });

  it('refuses versions it does not know, and owners that are not account ids', () => {
    for (const bad of [0, SAVE_VERSION + 1, 99, '2', null]) expect(() => parseSavedWorld({ ...via(), version: bad })).toThrow(SaveError);
    for (const owner of [0, -1, 1.5, 'x', NaN, {}]) {
      const s = via(); s.people[0].owner = owner;
      expect(() => parseSavedWorld(s), String(owner)).toThrow(/owner|number/);
    }
  });
});

describe('what a viewer is sent', () => {
  it('the world a restart brings back has the same people with the same ids', () => {
    const before = people.map(p => [p.id, p.name, p.slot!.id]);
    restoreWorld(parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld()))));
    expect(people.map(p => [p.id, p.name, p.slot!.id])).toEqual(before);
    newDay();
  });
});
