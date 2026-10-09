import { beforeEach, describe, expect, it } from 'vitest';
import { setSeed } from '../util';
import { initDay, newDay } from './day';
import { simEvents } from './events';
import { interactables } from './interactables';
import { hasSlot, isAi, isDriven } from './person';
import { parseSavedWorld, restoreWorld, serializeWorld } from './persist';
import { PROP_KEYS } from './props';
import { ENTRY } from './spots';
import { meetings, people, sim } from './state';
import { stepSim } from './step';
import { handBack, makeGuest, removeGuest, setLook, takeControl } from './takeover';
import { buildTestLayout } from './testing';
import type { Person } from './types';

// Phase 3, step 3, the simulation half: taking a person over, handing them back, and guests.

const DT = .05;
const run = (minutes: number) => { const until = sim.t + minutes; while (sim.t < until) stepSim(DT); };
const find = (pred: (p: Person) => boolean, maxMinutes = 600): Person => {
  for (let i = 0; i < maxMinutes * 50; i++) { const p = people.find(pred); if (p) return p; stepSim(DT); }
  throw new Error('nobody matched in time');
};
let updated: Person[], added: Person[], removed: Person[];
beforeEach(() => {
  simEvents.clear();
  setSeed(1); buildTestLayout({ desks: 40 }); initDay();
  updated = []; added = []; removed = [];
  simEvents.on('personUpdated', p => updated.push(p));
  simEvents.on('personAdded', p => added.push(p));
  simEvents.on('personRemoved', p => removed.push(p));
});

describe('taking a person over', () => {
  it('happens where they stand: no teleport, and everything they were doing stops cleanly', () => {
    const p = find(q => q.state === 'doing' && q.task?.kind === 'work');
    const at = [p.pos.x, p.pos.z];
    takeControl(p);
    expect([p.pos.x, p.pos.z]).toEqual(at);
    expect([p.controller, p.state, p.task, p.path, p.shown]).toEqual(['account', 'controlled', null, null, true]);
    expect(updated).toEqual([p]);
  });

  it('puts down what is in their hand and frees the shared seat they were using', () => {
    const p = find(q => q.state === 'doing' && PROP_KEYS.some(k => q.props[k]) && !!q.task?.spot.shared);
    const spot = p.task!.spot;
    expect(spot.occupant).toBe(p);
    takeControl(p);
    expect(PROP_KEYS.some(k => p.props[k])).toBe(false);
    expect(spot.occupant).toBeNull();
  });

  it('someone who is not in yet walks in at the entrance, and that counts as arriving', () => {
    const p = people.find(q => q.state === 'away' && q.arrivedAt === null)!;
    expect(p).toBeDefined();
    takeControl(p);
    expect([p.pos.x, p.pos.z]).toEqual([ENTRY.x, ENTRY.z]);
    expect(p.arrivedAt).toBe(sim.t);
    expect(p.shown).toBe(true);
  });

  it('someone who has gone home comes back in at the entrance too', () => {
    while (sim.day === 1) stepSim(DT);
    run(30); // the next morning, some are in
    const gone = people.find(q => q.state === 'away')!;
    gone.pos.x = 99; // wherever they were
    takeControl(gone);
    expect([gone.pos.x, gone.pos.z]).toEqual([ENTRY.x, ENTRY.z]);
    expect(gone.shown).toBe(true);
  });

  it('leaves a meeting properly: out of the members, not the speaker, and the meeting carries on', () => {
    const p = find(q => !!q.meeting && q.state === 'doing');
    const m = p.meeting!;
    const others = m.members.filter(x => x !== p).length;
    if (m.speaker !== p) m.speaker = p; // make the point the hardest way: the speaker is taken
    takeControl(p);
    expect(m.members).not.toContain(p);
    expect(m.members).toHaveLength(others);
    expect(m.speaker).toBeNull();
    expect(p.meeting).toBeNull();
    run(60); // the meeting runs out normally, no crash
    expect(meetings.includes(m)).toBe(false);
  });

  it('anyone who was chatting with them forgets it', () => {
    const talker = find(q => q.state === 'doing' && q.task?.kind === 'chat' && !!q.task.partner);
    const partner = talker.task!.partner!;
    takeControl(partner);
    expect(talker.task?.partner).toBeUndefined();
    expect(partner.chatWith).toBeNull();
  });

  it('twice does nothing the second time', () => {
    const p = people[3];
    takeControl(p); takeControl(p);
    expect(updated).toHaveLength(1);
  });

  it('after which the simulation leaves them alone: not stepped, not in meetings, not sent home at night', () => {
    const p = people[5];
    takeControl(p);
    p.pos.x = 3; p.pos.z = 4;
    while (sim.day === 1) { stepSim(DT); for (const m of meetings) expect(m.members).not.toContain(p); }
    expect([p.state, p.shown, p.pos.x, p.pos.z, p.animT]).toEqual(['controlled', true, 3, 4, p.animT]);
    newDay();
    expect(p.state).toBe('controlled');
  });
});

describe('handing a person back', () => {
  it('they carry on from where they stand and soon do something', () => {
    const p = people[8];
    takeControl(p);
    p.pos.x += 1; p.pos.z += 1;
    const at = [p.pos.x, p.pos.z];
    handBack(p);
    expect([p.controller, p.state, p.task, p.shown]).toEqual(['ai', 'idle', null, true]);
    expect([p.pos.x, p.pos.z]).toEqual(at);
    run(3);
    expect(['doing', 'walking']).toContain(p.state);
  });

  it('a seat they were sitting in is freed', () => {
    const p = people[9];
    takeControl(p);
    const seat = interactables.of('lounge')[0];
    seat.occupant = p;
    p.task = { kind: 'playerSit', cat: 'break', anim: 'relax', spot: seat };
    handBack(p);
    expect(seat.occupant).toBeNull();
    expect(p.task).toBeNull();
  });

  it('late in the day they go home like everyone else', () => {
    const p = people[10];
    takeControl(p);
    while (sim.t < 18 * 60 + 55) stepSim(DT);
    handBack(p);
    while (sim.day === 1 && sim.t < 19 * 60 + 9) stepSim(DT); // (not run(): the clock jumps back at 19:10)
    expect(sim.day).toBe(1);
    expect(p.state).toBe('away');
    expect(p.shown).toBe(false);
  });

  it('a guest has no desk to go back to: handing one back removes them', () => {
    const g = makeGuest(5, 'visitor');
    handBack(g);
    expect(people).not.toContain(g);
    expect(removed).toEqual([g]);
  });

  it('a person who was never taken over is not affected', () => {
    const p = people[11];
    handBack(p);
    expect(updated).toHaveLength(0);
    expect(p.controller).toBe('ai');
  });

  it('can be taken over and handed back many times without losing track of anything', () => {
    const p = people[12];
    for (let i = 0; i < 20; i++) { takeControl(p); run(1); handBack(p); run(1); }
    expect(people.filter(q => q === p)).toHaveLength(1);
    expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
    expect(updated).toHaveLength(40);
  });
});

describe('being played across a day change', () => {
  it('gives the person the new day schedule when they are handed back, and they do not leave at once', () => {
    const p = people[14];
    takeControl(p);
    while (sim.day === 1) stepSim(DT); // the day changes while a human has them: the reset only touches people the simulation drives
    expect(p.leaveAt).toBeLessThan(24 * 60); // (still yesterday's times)
    handBack(p);
    expect(p.arrivedAt).toBe(sim.t);
    expect(p.arriveAt).toBe(sim.t);
    expect(p.hadLunch).toBe(false); // it is early morning of the new day
    expect(p.leaveAt).toBeGreaterThan(17 * 60);
    expect(p.leaveAt).toBeLessThan(19 * 60);
    run(60);
    expect(p.state).not.toBe('away'); // an hour in, they are still at work, not sent home by an old leaving time
  });
  it('a hand-back on the same day leaves the schedule alone', () => {
    const p = people[15];
    const leave = p.leaveAt;
    takeControl(p); run(2); handBack(p);
    expect(p.leaveAt).toBe(leave);
  });
});

describe('guests', () => {
  it('appear at the entrance with their own id, have no desk, and are not counted as a slot', () => {
    const slots = people.filter(hasSlot).length;
    const g = makeGuest(7, 'visitor');
    expect([g.pos.x, g.pos.z]).toEqual([ENTRY.x, ENTRY.z]);
    expect([g.controller, g.state, g.owner, g.role, g.shown]).toEqual(['account', 'controlled', 7, 'Guest', true]);
    expect(g.slot).toBeUndefined();
    expect(people.filter(hasSlot)).toHaveLength(slots);
    expect(new Set(people.map(p => p.id)).size).toBe(people.length);
    expect(added).toEqual([g]);
  });

  it('are removed completely when they go, and their id is free again', () => {
    const g = makeGuest(7, 'visitor'), id = g.id;
    removeGuest(g);
    expect(people).not.toContain(g);
    expect(removed).toEqual([g]);
    const g2 = makeGuest(8, 'next');
    expect(g2.id).toBe(id);
  });

  it('survive a whole day untouched, and do not appear in the saved world', () => {
    const g = makeGuest(7, 'visitor');
    g.pos.x = 5;
    while (sim.day === 1) stepSim(DT);
    expect([g.state, g.pos.x, g.shown]).toEqual(['controlled', 5, true]);
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    expect(saved.people.every((s: { owner: number | null }) => s.owner !== 7)).toBe(true);
    expect(saved.people).toHaveLength(40);
  });

  it('take a given look, normalised', () => {
    const g = makeGuest(7, 'visitor', { skin: '#123456', style: 'mohawk', scale: 9 });
    expect(g.spec.skin).toBe('#123456');
    expect(g.spec.style).toBe('short');
    expect(g.spec.scale).toBe(1.1);
  });
});

describe('look', () => {
  it('setLook normalises and tells viewers', () => {
    const p = people[2];
    const out = setLook(p, { hair: '#abcdef', scale: 0.1 });
    expect(out.hair).toBe('#abcdef');
    expect(out.scale).toBe(0.9);
    expect(p.spec).toBe(out);
    expect(updated).toEqual([p]);
  });
});

describe('the save', () => {
  it('a person who was being driven comes back on autopilot with the owner', () => {
    const p = people[4];
    p.owner = 42;
    takeControl(p);
    const saved = parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld())));
    restoreWorld(saved);
    const back = people.find(q => q.owner === 42)!;
    expect([back.controller, back.state]).toEqual(['ai', 'idle']);
  });
});

describe('the world stays consistent', () => {
  it('through a day of random takeovers, hand-backs, guests, meetings and chats', () => {
    let seed = 99; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const guests: Person[] = [];
    for (let i = 0; i < 28000 && sim.day === 1; i++) {
      stepSim(DT);
      if (i % 40 === 0) {
        const r = rand(), p = people[Math.floor(rand() * people.length)];
        if (r < 0.3) takeControl(p);
        else if (r < 0.6) handBack(p);
        else if (r < 0.7) guests.push(makeGuest(100 + i, 'g' + i));
        else if (r < 0.8 && guests.length) removeGuest(guests.splice(Math.floor(rand() * guests.length), 1)[0]);
      }
      if (i % 500 === 0) {
        expect(new Set(people.map(p => p.id)).size).toBe(people.length);
        for (const p of people) {
          expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), p.name).toBe(true);
          if (isDriven(p)) expect([p.state, p.task === null || p.task.kind === 'playerSit'].join()).toBe('controlled,true');
          if (isAi(p) && hasSlot(p)) expect(p.slot!.owner).toBe(p);
        }
        for (const m of meetings) for (const member of m.members) expect(isAi(member)).toBe(true);
        for (const spot of interactables.all()) {
          const o = spot.occupant as Person | null;
          if (o) expect(people, `${spot.id} occupied by someone who left`).toContain(o);
        }
      }
    }
  }, 60000);
});
