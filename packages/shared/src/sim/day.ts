import { random, rnd, shuffle } from '../util';
import { makeHelper, makeStaff, scheduleDay } from './factory';
import { seatCarried } from '../world/objects';
import { interactables } from './interactables';
import { live, usesAttendance } from './live';
import { isAi, isHelper } from './person';
import { roster } from './roster';
import { DAY_START } from './schedule';
import { addLog, meetings, people, sim } from './state';
import { ENTRY } from './spots';
import { cleanNext, endTask, goWork, lockerTrip, placeNow, putBucketBack, whiteboard } from './tasks';
import type { Meeting, Person } from './types';

/* ---------- Day cycle ---------- */
export function phaseName(t: number): string {
  if (t < 9 * 60) return 'Arrivals'; if (t < 12 * 60) return 'Morning focus'; if (t < 13 * 60) return 'Lunch hour';
  if (t < 15 * 60) return 'Afternoon work'; if (t < 15 * 60 + 25) return 'Afternoon break'; if (t < 17 * 60) return 'Afternoon work';
  if (t < 17 * 60 + 25) return 'Late break'; if (t < 18 * 60 + 30) return 'Wrapping up'; if (t < 21 * 60) return 'Evening';
  return 'Night shift';
}
export function newDay(): void {
  sim.day++; if (live.mode !== 'live') sim.t = DAY_START; // the live clock is already the real time
  clearDay();
  addLog(`Day ${sim.day} begins`);
}
/** Everyone out, today's times recomputed. */
function clearDay(): void {
  meetings.length = 0;
  people.forEach(p => { if (p.props.bucket) putBucketBack(p); if (isAi(p)) p.toiletUntil = null; }); // (the one bucket is always back by morning)
  people.filter(isAi).forEach(p => { endTask(p); p.queue = []; p.state = 'away'; p.task = null; p.chatWith = null; p.meeting = null; p.shown = false; scheduleDay(p); });
}
/** After the clock jumps (switching to Live, or back to Simulate): everyone who should be in right now is at their desk. */
export function resetDay(): void {
  clearDay();
  for (const p of people.filter(isAi)) if (sim.t >= p.arriveAt && sim.t < p.leaveAt) seatNow(p);
}
function seatNow(p: Person): void {
  p.arrivedAt = p.arriveAt; p.shown = true;
  if (isHelper(p)) { p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI; p.until = 0; cleanNext(p); return; } // no desk: in at the door, straight to cleaning
  placeNow(p, { kind: 'work', cat: 'work', anim: 'type', spot: p.slot!, dur: rnd(2, 40) });
}
export function arriveNow(p: Person, quiet?: boolean): void {
  p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI; p.arrivedAt = sim.t;
  p.shown = true; p.task = null;
  if (!quiet) addLog(`${p.name} arrived`);
  if (isHelper(p)) { p.until = 0; cleanNext(p); return; }
  if (random() < .25 && lockerTrip(p)) return;
  if (!goWork(p)) p.state = p.slot && seatCarried(p.slot) ? 'idle' : 'away'; // (their chair is in somebody's hands: they wait, and try again, instead of going home for the day)
}

/* ---------- Initial state: a live mid-morning ---------- */
function populate(n: number): void {
  for (let i = 0; i < n; i++) {
    const p = makeStaff(); if (!p) break;
    const onShift = sim.t >= p.arriveAt && sim.t < p.leaveAt;
    if (onShift && (usesAttendance() || random() < .92)) seatNow(p); // clocked in means at their desk
    else if (onShift) p.arriveAt = rnd(sim.t + 1, sim.t + 40); // running late
  }
}

/** Make sure the office has its helper (the server makes her again after a restart: she is not saved). In the office at once if it is her working time. */
export function ensureHelper(): void {
  if (people.some(isHelper)) return;
  const h = makeHelper();
  if (sim.t >= h.lunchAt) h.hadLunch = true; // (a restart after lunchtime does not give her a second lunch)
  if (sim.t >= h.arriveAt && sim.t < h.leaveAt) seatNow(h);
}

/** Start the day with `staff` people (default: everyone on the staff list, else 40; never more than there are desks). */
export function initDay(staff: number = roster.list ? roster.list.length : 40): void {
  populate(staff);
  ensureHelper(); // our helper, cleaning
  // kick things off mid-morning (working hours, so no games): a training, a sync, a call, coffee and a whiteboard discussion (only if the
  // day starts during office hours)
  if (sim.t > 9 * 60 + 15 && sim.t < 17 * 60) {
    const here = () => shuffle(people.filter(p => p.state === 'doing' && p.task!.kind === 'work'));
    const meet = (room: number, n: number, topic: string, mins: number) => {
      const m: Meeting = { room, start: sim.t, end: sim.t + mins, members: [], speaker: null, swap: 0, topic };
      const seats = interactables.conf(room).filter(s => !seatCarried(s));
      n = Math.min(n, seats.length); if (n < 2) return;
      here().slice(0, n).forEach((p, i) => { placeNow(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: seats[i], until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } }); m.members.push(p); });
      meetings.push(m); addLog(`${topic[0].toUpperCase() + topic.slice(1)} started in Conference ${room} (${m.members.length})`);
    };
    meet(1, 6, 'training session', 30); meet(3, 4, 'client sync', 22);
    const a = here()[0]; if (a) placeNow(a, { kind: 'phone', cat: 'phone', anim: 'phone', spot: interactables.of('booth')[1], dur: 12, onStart: q => { q.props.phone = true; }, onEnd: q => { q.props.phone = false; } });
    const b = here()[0]; if (b) placeNow(b, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: interactables.of('counter')[0], dur: 5, onStart: q => { q.coffees++; q.props.mug = true; }, onEnd: q => { q.props.mug = false; } });
    const c = here()[0]; if (c) placeNow(c, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: interactables.of('bar')[0], dur: 6, onStart: q => { q.props.mug = true; }, onEnd: q => { q.props.mug = false; } });
    whiteboard(here()[0]);
    here().slice(0, 3).forEach(p => { p.until = sim.t + rnd(.2, 2); });
  }
}
