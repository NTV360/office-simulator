import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSeed } from '../util';
import { ensureHelper, initDay } from './day';
import { makeHelper, removeStaff, setStaffCount } from './factory';
import { HELPER_NAME } from './helper';
import { hasSlot, isAi, isHelper } from './person';
import { parseSavedWorld, restoreWorld, serializeWorld } from './persist';
import { roster } from './roster';
import { onBreak } from './schedule';
import { meetings, people, sim } from './state';
import { stepSim } from './step';
import { buildTestLayout } from './testing';
import type { Person, Task } from './types';

// The office helper: one person with no desk who cleans all day, and the dining TV's movie breaks.

const DT = .05;
const helper = (): Person | undefined => people.find(isHelper);

beforeEach(() => { roster.list = null; setSeed(1); buildTestLayout({ desks: 40 }); });
afterEach(() => { roster.list = null; setSeed(null); });

describe('the helper', () => {
  it('is made with the office: one person, no desk, not counted as staff, with her own name, job and black clothes', () => {
    initDay();
    const h = helper()!;
    expect(h).toBeDefined();
    expect(people.filter(isHelper)).toHaveLength(1);
    expect([h.name, h.title, h.role, h.controller, h.slot, h.owner, h.userId]).toEqual([HELPER_NAME, 'Housekeeping', 'Support', 'ai', undefined, undefined, null]);
    expect(people.filter(hasSlot)).toHaveLength(40);
    expect(h.spec.top.color).toBe('#1b1b1d');
    expect(isAi(h)).toBe(true);
  });

  it('is told apart from a guest (a human with no desk) and from staff', () => {
    initDay();
    const staffer = people.find(hasSlot)!;
    expect(isHelper(staffer)).toBe(false);
    expect(isHelper({ controller: 'account' })).toBe(false); // a guest
    expect(isHelper({ controller: 'ai' })).toBe(true);
  });

  it('is never removed with the staff, and setting the staff to nobody leaves her', () => {
    initDay();
    while (removeStaff());
    expect(people.filter(isHelper)).toHaveLength(1);
    expect(people.filter(hasSlot)).toHaveLength(0);
    setStaffCount(10);
    expect(people.filter(hasSlot)).toHaveLength(10);
    expect(people.filter(isHelper)).toHaveLength(1);
  });

  it('cleans all day: every kind of job, with the rag or the mop in hand only while she does it, and never as part of a meeting or a chat', () => {
    initDay();
    const h = helper()!;
    const jobs = new Set<string>(), seen = new WeakSet<Task>();
    let wrongProps = 0;
    while (sim.day === 1) {
      stepSim(DT);
      const t = h.task;
      if (t && !seen.has(t)) { seen.add(t); if (t.kind === 'clean') jobs.add(t.anim); }
      const cleaning = h.state === 'doing' && h.task?.kind === 'clean';
      if (h.props.rag && !(cleaning && ['wipe', 'windowWipe'].includes(h.task!.anim))) wrongProps++;
      if (h.props.mop && !(cleaning && h.task!.anim === 'mop')) wrongProps++;
      expect(h.meeting, 'never in a meeting').toBeNull();
      expect(h.chatWith, 'nobody chats with her').toBeNull();
    }
    expect([...jobs].sort()).toEqual(['locker', 'mop', 'windowWipe', 'wipe']);
    expect(wrongProps).toBe(0);
    expect(h.props.rag || h.props.mop).toBe(false);
  });

  it('arrives in the morning, has lunch, goes home in the evening, and is back the next day', () => {
    initDay();
    const h = helper()!;
    let sawIn = false, sawLunch = false, stayedLate = false;
    while (sim.day === 1) {
      stepSim(DT);
      if (sim.t > 19 * 60 /* the day shift ends by 18:20 */ && sim.t < 24 * 60 && h.state !== 'away') stayedLate = true;
      if (h.state !== 'away') sawIn = true;
      if (h.task?.kind === 'lunch') sawLunch = true;
    }
    expect(sawIn && sawLunch).toBe(true);
    expect(stayedLate, 'she goes home after her shift').toBe(false);
    expect(h.state).toBe('away'); // (the day ended with her at home)
    const before = people.length;
    while (sim.t < 12 * 60) stepSim(DT);
    expect(people).toHaveLength(before);
    expect(h.state).not.toBe('away'); // the next day she is in again
  });

  it('is not saved with the world; the server makes her again, once, and at work at once if it is her time', () => {
    initDay();
    while (sim.t < 11 * 60) stepSim(DT);
    expect(serializeWorld().people.some(p => p.name === HELPER_NAME)).toBe(false);
    restoreWorld(parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld()))));
    expect(people.some(isHelper)).toBe(false);
    ensureHelper(); ensureHelper();
    expect(people.filter(isHelper)).toHaveLength(1);
    const h = helper()!;
    expect(h.shown && h.state !== 'away').toBe(true); // 11:00 is her working time
    expect(meetings).toHaveLength(0);
  });

  it('does not appear in a world restored at night (she is made, but at home)', () => {
    initDay();
    sim.t = 23 * 60;
    restoreWorld(parseSavedWorld(JSON.parse(JSON.stringify(serializeWorld()))));
    ensureHelper();
    expect(helper()!.state).toBe('away');
  });

  it('a save entry without a desk is nobody (so it cannot pass for the helper); she is made as usual', () => {
    initDay();
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    saved.people[0].slot = ''; // (an old or hand-made save)
    restoreWorld(parseSavedWorld(saved));
    expect(people).toHaveLength(39);
    expect(people.some(isHelper)).toBe(false);
    ensureHelper();
    expect(people.filter(isHelper)).toHaveLength(1);
  });

  it('what she stands at is the real chair or locker, so nobody else is sent to it while she is there', () => {
    initDay();
    const h = helper()!;
    let checked = 0;
    while (sim.day === 1 && checked < 20) {
      stepSim(DT);
      const s = h.task?.spot;
      if (h.state === 'doing' && h.task?.kind === 'clean' && h.task.anim !== 'mop' && h.task.anim !== 'windowWipe' && s && 'id' in s) {
        checked++;
        expect(s.occupant, 'the spot is hers while she works there').toBe(h);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('an idle helper who is told to wait (nothing was free) waits until then, instead of searching every tick', () => {
    initDay();
    const h = helper()!;
    h.state = 'idle'; h.task = null; h.path = null; h.until = sim.t + 2;
    for (let i = 0; i < 20; i++) { stepSim(DT); if (sim.t >= h.until) break; }
    expect(h.state === 'idle' && h.task === null, 'still waiting').toBe(true);
    expect(sim.t).toBeLessThan(h.until);
    while (sim.t < h.until + 1) stepSim(DT);
    expect(h.state === 'idle' && h.task === null, 'and she gets on with it afterwards').toBe(false);
  });

  it('makeHelper takes no desk', () => {
    initDay(0);
    const desks = people.length;
    const h = makeHelper();
    expect(h.slot).toBeUndefined();
    expect(people.filter(hasSlot)).toHaveLength(0);
    expect(people.length).toBe(desks + 1);
  });
});

describe('the dining TV', () => {
  it('movie breaks happen, only on breaks, at a dining seat', () => {
    initDay();
    const seen = new WeakSet<Task>();
    let tv = 0;
    while (sim.day === 1) {
      stepSim(DT);
      for (const p of people.filter(hasSlot)) {
        const t = p.task;
        if (!t || seen.has(t)) continue;
        seen.add(t);
        if (t.kind === 'tv') { tv++; expect(t.spot.kind).toBe('dining'); expect(t.cat).toBe('break'); expect(onBreak(p, sim.t), `${p.name} started a movie at ${sim.t.toFixed(1)}, not on a break`).toBe(true); }
      }
    }
    expect(tv).toBeGreaterThan(5);
  });
});
