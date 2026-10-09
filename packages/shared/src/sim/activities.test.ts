import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSeed } from '../util';
import { initDay } from './day';
import { hasSlot } from './person';
import { roster, type Employee } from './roster';
import { onBreak } from './schedule';
import { meetings, people, sim } from './state';
import { stepSim } from './step';
import { buildTestLayout } from './testing';
import type { Person, Task } from './types';

// A whole working day, watched. People work during their shift and play only on their breaks; the new activities
// (whiteboards, snacks, the toilet bucket) happen; the HR office holds no meetings.

const DT = .05;
const staff = () => people.filter(hasSlot);
const PLAY = ['game', 'golf', 'darts', 'piano', 'guitar', 'sofa'];

interface Started { p: Person; task: Task; t: number; onBreak: boolean }

/** Run the rest of day 1, reporting every new task the moment it is given out. */
function watchDay(seed: number, each?: (started: Started[]) => void): Started[] {
  setSeed(seed);
  buildTestLayout({ desks: 40, hr: 6 });
  initDay();
  const seen = new WeakSet<Task>(), started: Started[] = [];
  for (const p of staff()) if (p.task) seen.add(p.task);
  while (sim.day === 1) {
    stepSim(DT);
    for (const p of staff()) if (p.task && !seen.has(p.task)) { seen.add(p.task); started.push({ p, task: p.task, t: sim.t, onBreak: onBreak(p, sim.t) }); }
    each?.(started);
  }
  return started;
}

beforeEach(() => { roster.list = null; });
afterEach(() => { roster.list = null; setSeed(null); });

describe('breaks and work', () => {
  it('games, golf, darts, the music corner and the sofa are only ever started on a break', () => {
    for (const seed of [1, 2, 3]) {
      const started = watchDay(seed);
      const play = started.filter(s => PLAY.includes(s.task.kind));
      expect(play.length, `seed ${seed}: people do play on their breaks`).toBeGreaterThan(10);
      for (const s of play) expect(s.onBreak, `seed ${seed}: ${s.p.name} started ${s.task.kind} at ${s.t.toFixed(1)} (not on a break)`).toBe(true);
    }
  });
  it('a night shift plays on its own breaks, not the day shift\'s', () => {
    setSeed(4);
    buildTestLayout({ desks: 12 });
    roster.list = Array.from({ length: 12 }, (_, i): Employee => ({ userId: 'n' + i, firstName: 'N' + i, lastName: 'T', department: 'UI/UX', intern: false, character: null, desk: null, shift: { code: 'NIGHT', start: 21 * 60, end: 6 * 60 } }));
    initDay();
    sim.t = 21 * 60 + 30;
    const seen = new WeakSet<Task>(); const bad: string[] = []; let played = 0;
    while (sim.day === 1) {
      stepSim(DT);
      for (const p of staff()) if (p.task && !seen.has(p.task)) {
        seen.add(p.task);
        if (PLAY.includes(p.task.kind)) { played++; if (!onBreak(p, sim.t)) bad.push(`${p.name} ${p.task.kind} at ${sim.t.toFixed(0)}`); }
      }
    }
    expect(played).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
  it('when the lunch hour starts most people get up from their desks within the hour', () => {
    setSeed(2);
    buildTestLayout({ desks: 40 });
    initDay();
    while (sim.t < 11 * 60 + 55) stepSim(DT);
    const atDesk = () => staff().filter(p => p.state !== 'away' && p.state === 'doing' && p.task?.kind === 'work').length;
    const before = atDesk();
    while (sim.t < 12 * 60 + 25) stepSim(DT);
    expect(atDesk()).toBeLessThan(before * .6);
  });
});

describe('the new activities', () => {
  it('there are whiteboard discussions: a presenter and one or two colleagues, starting together and ending together', () => {
    const groups: Started[][] = [];
    for (const seed of [1, 2, 3]) {
      const started = watchDay(seed);
      const boards = started.filter(s => s.task.kind === 'whiteboard');
      expect(boards.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const lead of boards.filter(s => s.task.anim === 'present')) {
        const mates = boards.filter(s => s.task.anim === 'talkStand' && s.task.partner === lead.p && s.t === lead.t); // given out in the same moment
        expect(mates.length, `${lead.p.name}'s discussion at ${lead.t.toFixed(0)}`).toBeGreaterThanOrEqual(1);
        expect(mates.length).toBeLessThanOrEqual(2);
        for (const m of mates) expect(m.task.until).toBe(lead.task.until);
      }
      groups.push(boards);
    }
    expect(groups.flat().length).toBeGreaterThan(5);
  });
  it('a snack is fetched from the cabinet and eaten at the desk', () => {
    const started = watchDay(1);
    const snacks = started.filter(s => s.task.kind === 'snack');
    expect(snacks.length).toBeGreaterThan(0);
    for (const s of snacks) {
      const next = started.find(x => x.p === s.p && x.t > s.t);
      expect(next?.task.kind, `${s.p.name} after the snack`).toBe('snackDesk');
      expect(next!.task.spot).toBe(s.p.slot);
    }
  });
  it('the toilet run: one person at a time grabs the bucket, runs out, is away a few minutes, comes back with it and puts it back', () => {
    let sawOut = false, checkedEvening = false;
    const holders = new Set<string>();
    const started = watchDay(1, () => {
      const holding = staff().filter(p => p.props.bucket);
      expect(holding.length).toBeLessThanOrEqual(1); // there is one bucket
      for (const p of holding) holders.add(p.name);
      if (staff().some(p => p.toiletUntil)) sawOut = true;
      // well before the day rolls over (which would put everything back by force): everyone has left, so the bucket must be back and nobody still out
      if (sim.t > 21 * 60 && !checkedEvening) {
        checkedEvening = true;
        expect(staff().filter(p => p.props.bucket), 'the bucket is back by the evening').toEqual([]);
        expect(staff().some(p => p.toiletUntil), 'nobody is still out on the toilet run in the evening').toBe(false);
      }
    });
    expect(checkedEvening).toBe(true);
    expect(started.some(s => s.task.kind === 'bucket')).toBe(true);
    expect(sawOut).toBe(true);
    expect(holders.size).toBeGreaterThan(0);
    // each run is a bucket task (at a run), then the toilet (at a run), then later the bucket goes back (at a walk)
    for (const s of started.filter(x => x.task.kind === 'bucket')) {
      expect(s.task.run).toBe(true);
      const exit = started.find(x => x.p === s.p && x.task.kind === 'toilet' && x.t > s.t);
      if (exit) expect(exit.task.run).toBe(true);
    }
  });
  it('someone out on the toilet run is out of the building and not drawn, and comes back through the front door', () => {
    let checked = 0;
    watchDay(1, () => {
      for (const p of staff().filter(q => q.toiletUntil)) {
        expect(p.state).toBe('away'); expect(p.shown).toBe(false); expect(p.props.bucket).toBe(true);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe('meetings', () => {
  it('are held in Conference 1 and 3 only: the HR office (room 2) has desks, not meeting seats', () => {
    const rooms = new Set<number>();
    watchDay(1, () => { for (const m of meetings) rooms.add(m.room); });
    expect([...rooms].sort()).toEqual([1, 3]);
  });
  it('nobody is pulled into a meeting from a break', () => {
    const started = watchDay(2);
    const meetingsStarted = started.filter(s => s.task.kind === 'meeting' && s.t > 9 * 60 + 20);
    expect(meetingsStarted.length).toBeGreaterThan(3); // there are meetings to look at
    expect(meetingsStarted.filter(s => s.onBreak).map(s => `${s.p.name} at ${s.t.toFixed(0)}`)).toEqual([]);
  });
});
