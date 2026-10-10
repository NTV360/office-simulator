import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode, decode } from '../protocol/codec';
import { personInfo, personSnap } from '../protocol/convert';
import { parseSavedWorld, restoreWorld, serializeWorld } from './persist';
import { NEVER } from './schedule';
import { meetings } from './state';
import { setSeed } from '../util';
import { initDay } from './day';
import { SIM_START, applyAttendance, initLive, live, liveDay, liveMinutes, liveSchedule, resetLive, setAttendance, setMode, tickLive, usesAttendance } from './live';
import { fromDbUtc, officeDate, officeMinutes } from './office-time';
import { roster, type Employee } from './roster';
import { people, sim } from './state';
import { stepSim } from './step';
import { hasSlot } from './person';
import { buildTestLayout } from './testing';

// The office clock: Manila time, the 06:00-to-06:00 sim day, and who is in from attendance.

// Manila is UTC+8: 03:30 in Manila on the 10th is 19:30 UTC on the 9th
const MANILA = (hh: number, mm = 0, day = 10) => new Date(Date.UTC(2026, 9, day, hh - 8, mm));

beforeEach(() => { resetLive(); setSeed(1); });
afterEach(() => { resetLive(); roster.list = null; setSeed(null); });

describe('office time', () => {
  it('reads minutes since midnight and the date in Manila, not where the server is', () => {
    expect(officeMinutes(MANILA(9, 30))).toBeCloseTo(9 * 60 + 30, 5);
    expect(officeDate(MANILA(9, 30))).toBe('2026-10-10');
    expect(officeDate(new Date(Date.UTC(2026, 9, 9, 17, 0)))).toBe('2026-10-10'); // 01:00 on the 10th in Manila, still the 9th in UTC
  });
  it('a database timestamp without a zone is UTC', () => {
    expect(fromDbUtc('2026-09-30 02:07:58.296')!.toISOString()).toBe('2026-09-30T02:07:58.296Z');
    expect(fromDbUtc(null)).toBeNull();
  });
});

describe('the live clock on the 06:00-to-06:00 sim day', () => {
  it('after midnight is 24:00 and up, until 06:00', () => {
    expect(liveMinutes(MANILA(23, 0))).toBeCloseTo(23 * 60, 5);
    expect(liveMinutes(MANILA(1, 30))).toBeCloseTo(25 * 60 + 30, 5);
    expect(liveMinutes(MANILA(5, 59))).toBeCloseTo(29 * 60 + 59, 5);
    expect(liveMinutes(MANILA(6, 0))).toBeCloseTo(6 * 60, 5);
  });
  it("before 06:00 it is still yesterday's sim day", () => {
    expect(liveDay(MANILA(5, 59))).toBe('2026-10-09');
    expect(liveDay(MANILA(6, 0))).toBe('2026-10-10');
    expect(liveDay(MANILA(23, 59))).toBe('2026-10-10');
  });
  it('tickLive follows the real time and says when a new sim day began', () => {
    live.date = '2026-10-09';
    expect(tickLive(MANILA(7, 0))).toBe(true);
    expect(sim.t).toBeCloseTo(7 * 60, 5);
    expect(tickLive(MANILA(7, 1))).toBe(false);
    expect(tickLive(MANILA(2, 0, 11))).toBe(false); // 02:00 on the 11th is the end of the 10th's day
    expect(sim.t).toBeCloseTo(26 * 60, 5);
  });
});

describe('switching the clock', () => {
  it('Simulate starts the day at 09:25 or the night at 21:30; Live jumps to the real time and unpauses', () => {
    sim.speed = 8; sim.paused = true;
    setMode('sim', 'night'); expect(sim.t).toBe(SIM_START.night); expect(live.mode).toBe('sim');
    setMode('sim'); expect(sim.t).toBe(SIM_START.day);
    setMode('live'); expect(live.mode).toBe('live'); expect(sim.speed).toBe(1); expect(sim.paused).toBe(false);
    expect(sim.t).toBeGreaterThanOrEqual(6 * 60);
  });
  it('initLive starts in Simulate on the day, and keeps attendance (when it loaded) for Live', () => {
    initLive({ records: [{ userId: 'a', clockIn: '2026-10-10T01:00:00Z', clockOut: null }] });
    expect(live.mode).toBe('sim'); expect(sim.t).toBe(SIM_START.day); expect(live.attendance).toBe(true); expect(live.att.has('a')).toBe(true);
    expect(usesAttendance()).toBe(false); // Simulate ignores it
    setMode('live'); expect(usesAttendance()).toBe(true);
  });
  it('in Live the simulation follows the real clock; the speed of Simulate does nothing', () => {
    buildTestLayout({ desks: 10 }); initDay(5);
    setMode('live');
    sim.speed = 8;
    stepSim(1);
    const real = liveMinutes();
    expect(Math.abs(sim.t - real)).toBeLessThan(1); // within a minute of the real time, not 8 minutes on from where it was
  });
});

const emp = (id: string, over: Partial<Employee> = {}): Employee => ({ userId: id, firstName: id, lastName: 'T', department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over });

describe('attendance', () => {
  it("today's times come from the clock-in and the clock-out; no record means not in today", () => {
    buildTestLayout({ desks: 10 });
    roster.list = [emp('in'), emp('gone'), emp('none')];
    initLive({ records: [] });
    setAttendance([
      { userId: 'in', clockIn: MANILA(8, 55).toISOString(), clockOut: null },
      { userId: 'gone', clockIn: MANILA(8, 0).toISOString(), clockOut: MANILA(10, 0).toISOString() },
    ]);
    initDay(3);
    const by = (id: string) => people.find(p => p.userId === id)!;
    liveSchedule(by('in')); expect(by('in').absent).toBe(false); expect(by('in').arriveAt).toBeCloseTo(8 * 60 + 55, 3); expect(by('in').leaveAt).toBe(NEVER);
    liveSchedule(by('gone')); expect(by('gone').leaveAt).toBeCloseTo(10 * 60, 3); expect(by('gone').arrivedAt).toBeCloseTo(8 * 60, 3);
    liveSchedule(by('none')); expect(by('none').absent).toBe(true); expect(by('none').arriveAt).toBe(NEVER);
  });

  it('in Live, a new clock-in walks in and a clock-out walks out (Simulate ignores both)', () => {
    buildTestLayout({ desks: 10 });
    roster.list = [emp('a'), emp('b')];
    initLive({ records: [{ userId: 'a', clockIn: MANILA(9, 0).toISOString(), clockOut: null }] });
    initDay(2);
    const a = people.find(p => p.userId === 'a')!, b = people.find(p => p.userId === 'b')!;
    sim.t = 11 * 60;
    // Simulate: attendance is ignored
    const leaveBefore = a.leaveAt;
    applyAttendance([{ userId: 'a', clockIn: MANILA(9, 0).toISOString(), clockOut: MANILA(10, 0).toISOString() }]);
    expect(a.leaveAt).toBe(leaveBefore);
    // Live: b clocks in, a clocks out
    live.mode = 'live'; sim.t = 11 * 60;
    setAttendance([{ userId: 'a', clockIn: MANILA(9, 0).toISOString(), clockOut: null }]);
    applyAttendance([{ userId: 'a', clockIn: MANILA(9, 0).toISOString(), clockOut: MANILA(11, 0).toISOString() }, { userId: 'b', clockIn: MANILA(11, 0).toISOString(), clockOut: null }]);
    expect(a.leaveAt).toBe(11 * 60);
    expect(b.absent).toBe(false); expect(b.arriveAt).toBe(11 * 60); expect(b.leaveAt).toBe(NEVER);
  });
});

describe('people the live clock has not clocked in (their times are "never")', () => {
  const setup = () => {
    buildTestLayout({ desks: 10 });
    roster.list = [emp('in'), emp('none')];
    initLive({ records: [] });
    setAttendance([{ userId: 'in', clockIn: MANILA(8, 55).toISOString(), clockOut: null }]);
    initDay(2);
    live.mode = 'live';
    for (const p of people) liveSchedule(p);
  };
  it('travel on the wire: a join and a snapshot of someone not in today, or in and not out, encode and decode', () => {
    setup();
    for (const p of people) {
      expect(() => encode({ type: 'person', info: personInfo(p), snap: personSnap(p, meetings) })).not.toThrow();
      const m = decode(encode({ type: 'person', info: personInfo(p), snap: personSnap(p, meetings) }));
      if (m.type !== 'person') throw new Error('not a person');
      expect(m.snap.absent).toBe(!!p.absent);
      expect(m.snap.leaveAt).toBeGreaterThanOrEqual(8 * 60); // (NEVER, or a real time)
    }
  });
  it('are saved and read back (a save with a person who is not in today is not refused)', () => {
    setup();
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    expect(saved.people.every((p: { arriveAt: unknown; leaveAt: unknown }) => typeof p.arriveAt === 'number' && typeof p.leaveAt === 'number')).toBe(true);
    expect(() => parseSavedWorld(saved)).not.toThrow();
    restoreWorld(parseSavedWorld(saved));
    expect(people.find(p => p.userId === 'none')!.absent).toBe(true);
  });
  it('a server restarted in Live stays on the same sim day (the first tick does not send everybody home)', () => {
    setup();
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    const day = sim.day, present = people.filter(p => hasSlot(p) && p.state !== 'away').length;
    resetLive();
    restoreWorld(parseSavedWorld(saved));
    expect(live.mode).toBe('live');
    stepSim(.05);
    expect(sim.day).toBe(day);
    expect(people.filter(p => hasSlot(p) && p.state !== 'away').length).toBe(present);
  });
});
