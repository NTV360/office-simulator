import { officeDate, officeMinutes } from './office-time';
import { DAY_START, NEVER } from './schedule';
import { addLog, people, sim } from './state';
import type { Person } from './types';

/* ================= The clock and real attendance ================= */
// Two modes. The server owns the choice (one for the whole office), never a single browser:
// - 'live': the actual time in the office's time zone. When the attendances list is readable, only employees who are clocked in are in
//   the office; clock-ins walk in, clock-outs walk out. Without it, people follow their shifts on the real clock.
// - 'sim' (the default, starting the day): the office's own faster clock (pause, 1x/3x/8x), starting the day or the night.
//   Everyone is simulated from their shift; attendance is ignored.
// (`main`'s `src/sim/live.js`.)

export type ClockMode = 'sim' | 'live';
/** One employee's attendance today, as dates. */
export interface Attendance { clockIn: Date | null; clockOut: Date | null }
/** One attendance record as it travels (ISO times). */
export interface AttendanceRecord { userId: string; clockIn: string | null; clockOut: string | null }

/** Where Simulate starts the clock. */
export const SIM_START = { day: 9 * 60 + 25, night: 21 * 60 + 30 } as const;

export const live: { mode: ClockMode; attendance: boolean; date: string | null; att: Map<string, Attendance> } = { mode: 'sim', attendance: false, date: null, att: new Map() };

/** The office time on the sim clock: the sim day runs 06:00-06:00, so after midnight is 24:00 and up. */
export function liveMinutes(date: Date = new Date()): number { const m = officeMinutes(date); return m < DAY_START ? m + 24 * 60 : m; }
/** The office date the current sim day started on (before 06:00 it still belongs to yesterday). */
export function liveDay(date: Date = new Date()): string { return officeDate(new Date(date.getTime() - DAY_START * 60000)); }

export function setAttendance(records: readonly AttendanceRecord[]): void {
  live.att = new Map(records.map(r => [r.userId, { clockIn: r.clockIn ? new Date(r.clockIn) : null, clockOut: r.clockOut ? new Date(r.clockOut) : null }]));
}
const isIn = (a: Attendance | undefined): boolean => !!a?.clockIn && !a.clockOut;

/** True when presence comes from attendance (Live with a readable attendances table). */
export const usesAttendance = (): boolean => live.mode === 'live' && live.attendance;

/** Today's times for one person from their attendance (used by scheduleDay in live mode). */
export function liveSchedule(p: Person): void {
  const a = p.userId ? live.att.get(p.userId) : undefined;
  p.absent = !a?.clockIn;
  if (p.absent) { p.arriveAt = NEVER; p.leaveAt = NEVER; return; }
  p.arriveAt = liveMinutes(a!.clockIn!);
  p.leaveAt = a!.clockOut ? liveMinutes(a!.clockOut) : NEVER;
  if (a!.clockOut) p.arrivedAt = p.arriveAt; // already came and went: "gone home"
}

/** New attendance from the importer: people who just clocked in come in, people who clocked out leave. */
export function applyAttendance(records: readonly AttendanceRecord[]): void {
  const before = live.att; setAttendance(records);
  if (!usesAttendance()) return; // Simulate ignores attendance
  for (const p of people) {
    if (!p.userId) continue;
    const was = isIn(before.get(p.userId)), now = isIn(live.att.get(p.userId));
    if (now && !was) { p.absent = false; p.arrivedAt = null; p.arriveAt = sim.t; p.leaveAt = NEVER; }
    if (!now && was) {
      p.leaveAt = sim.t;
      if (p.state === 'doing') p.until = sim.t; // finish up and head out
      addLog(`${p.name} clocked out`);
    }
  }
}

/** Every tick in Live: keep the sim clock on the office clock. Returns true when a new sim day started (06:00). */
export function tickLive(now: Date = new Date()): boolean {
  sim.t = liveMinutes(now);
  const day = liveDay(now);
  if (day === live.date) return false;
  live.date = day; return true;
}

/** Start simulating the day; keep attendance (when it loaded) for switching to Live. */
export function initLive(attendance?: { records: readonly AttendanceRecord[] } | null): void {
  live.mode = 'sim'; live.date = liveDay();
  if (attendance) { live.attendance = true; setAttendance(attendance.records); }
  sim.t = SIM_START.day; sim.speed = 1; sim.paused = false;
}

/**
 * Switch the clock. Live jumps to the real time; Simulate starts the day or the night (`when`). The caller then re-seats
 * everyone (`resetDay`).
 */
export function setMode(mode: ClockMode, when: 'day' | 'night' = 'day'): void {
  live.mode = mode;
  if (mode === 'live') { sim.t = liveMinutes(); live.date = liveDay(); sim.speed = 1; sim.paused = false; }
  else sim.t = SIM_START[when];
}

/** Back to the start: Simulate, no attendance (tests; the server at start-up). */
export function resetLive(): void { live.mode = 'sim'; live.attendance = false; live.date = null; live.att = new Map(); }
