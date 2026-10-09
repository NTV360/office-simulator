import { officeDate, officeMinutes } from '../config/office.js';
import { DAY_START } from './schedule.js';
import { addLog, people, sim } from './state.js';

/* ================= The clock and real attendance ================= */
// Two modes, switched in the HUD:
// - 'live' (the default): the actual time in the office's time zone. When the attendances list is readable,
//   only employees who are clocked in are in the office; clock-ins walk in, clock-outs walk out.
//   Without it, people follow their shifts on the real clock.
// - 'sim': the office's own faster clock (pause, 1×/3×/8×), starting the day or the night (SIM_START).
//   Everyone is simulated from their shift; attendance is ignored.
const live = { mode: 'live', attendance: false, date: null, att: new Map() }; // att: userId → { clockIn: Date, clockOut: Date | null }

// The office time on the sim clock: the sim day runs 06:00-06:00, so after midnight is 24:00 and up.
function liveMinutes(date = new Date()) { const m = officeMinutes(date); return m < DAY_START ? m + 24 * 60 : m; }
// The office date the current sim day started on (before 06:00 it still belongs to yesterday).
function liveDay(date = new Date()) { return officeDate(new Date(date.getTime() - DAY_START * 60000)); }

function setAttendance(records) {
  live.att = new Map(records.map(r => [r.userId, { clockIn: r.clockIn ? new Date(r.clockIn) : null, clockOut: r.clockOut ? new Date(r.clockOut) : null }]));
}
const isIn = a => !!a?.clockIn && !a.clockOut;

// Today's times for one person from their attendance (used by scheduleDay in live mode).
function liveSchedule(p) {
  const a = live.att.get(p.userId);
  p.absent = !a?.clockIn;
  if (p.absent) { p.arriveAt = Infinity; p.leaveAt = Infinity; return; }
  p.arriveAt = liveMinutes(a.clockIn);
  p.leaveAt = a.clockOut ? liveMinutes(a.clockOut) : Infinity;
  if (a.clockOut) p.arrivedAt = p.arriveAt; // already came and went: "gone home"
}

// New attendance from the server: people who just clocked in come in, people who clocked out leave.
function applyAttendance(records) {
  const before = live.att; setAttendance(records);
  if (!usesAttendance()) return; // Simulate ignores attendance
  for (const p of people) {
    if (!p.userId) continue;
    const was = isIn(before.get(p.userId)), now = isIn(live.att.get(p.userId));
    if (now && !was) { p.absent = false; p.arrivedAt = null; p.arriveAt = sim.t; p.leaveAt = Infinity; }
    if (!now && was) {
      p.leaveAt = sim.t;
      if (p.state === 'doing') p.until = sim.t; // finish up and head out
      addLog(`${p.name} clocked out`);
    }
  }
}

// Every frame: keep the sim clock on the office clock. Returns true when a new sim day started (06:00).
function tickLive() {
  sim.t = liveMinutes();
  const day = liveDay();
  if (day === live.date) return false;
  live.date = day; return true;
}

// Start on the real clock; use attendance for presence when it loaded.
function initLive(attendance) {
  live.mode = 'live'; live.date = liveDay();
  if (attendance) { live.attendance = true; setAttendance(attendance.records); }
  sim.t = liveMinutes(); sim.speed = 1; sim.paused = false;
}
const SIM_START = { day: 9 * 60 + 25, night: 21 * 60 + 30 };
// True when presence comes from attendance (Live with a readable attendances table).
function usesAttendance() { return live.mode === 'live' && live.attendance; }
// Switch the clock. Live jumps to the real time; Simulate starts the day or the night (`when`).
// The caller then re-seats everyone (resetDay).
function setMode(mode, when = 'day') {
  live.mode = mode;
  if (mode === 'live') { sim.t = liveMinutes(); live.date = liveDay(); sim.speed = 1; sim.paused = false; }
  else sim.t = SIM_START[when];
}

export { applyAttendance, initLive, live, liveSchedule, setMode, tickLive, usesAttendance };
