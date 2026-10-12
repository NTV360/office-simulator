import { rnd, shuffle } from '../core/util.js';
import { makeHelper, makePerson, scheduleDay } from '../people/factory.js';
import { roster } from '../people/roster.js';
import { meetings } from './meetings.js';
import { live, usesAttendance } from './live.js';
import { DAY_START } from './schedule.js';
import { addLog, people, sim } from './state.js';
import { cleanNext, endTask, goWork, lockerTrip, placeNow, putBucketBack, whiteboard } from './tasks.js';
import { ENTRY } from '../world/entrance.js';
import { interactables } from '../world/interactables.js';

/* ---------- Day cycle ---------- */
function phaseName(t) {
  if (t < 9 * 60) return 'Arrivals'; if (t < 12 * 60) return 'Morning focus'; if (t < 13 * 60) return 'Lunch hour';
  if (t < 15 * 60) return 'Afternoon work'; if (t < 15 * 60 + 25) return 'Afternoon break'; if (t < 17 * 60) return 'Afternoon work';
  if (t < 17 * 60 + 25) return 'Late break'; if (t < 18 * 60 + 30) return 'Wrapping up'; if (t < 21 * 60) return 'Evening';
  return 'Night shift';
}
function newDay() {
  sim.day++; if (live.mode !== 'live') sim.t = DAY_START; // the live clock is already the real time
  clearDay();
  addLog(`Day ${sim.day} begins`);
}
// Everyone out, today's times recomputed.
function clearDay() {
  meetings.length = 0;
  people.forEach(p => { if (p.body.bucket.visible) putBucketBack(p); p.toiletUntil = null; });
  people.forEach(p => { endTask(p); p.queue = []; p.state = 'away'; p.task = null; p.chatWith = null; p.meeting = null; p.body.root.visible = false; p.body.ring.visible = false; scheduleDay(p); });
}
// After the clock jumps (switching to Live): everyone who should be in right now is at their desk.
function resetDay() {
  clearDay();
  for (const p of people) if (sim.t >= p.arriveAt && sim.t < p.leaveAt) seatNow(p);
}
function seatNow(p) {
  p.arrivedAt = p.arriveAt; p.body.root.visible = true; p.body.ring.visible = true;
  if (p.helper) { p.state = 'idle'; cleanNext(p); return; } // no desk: straight to cleaning
  placeNow(p, { kind: 'work', cat: 'work', anim: 'type', spot: p.seat, dur: rnd(2, 40) });
}
function arriveNow(p, quiet) {
  p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI; p.arrivedAt = sim.t;
  p.body.root.visible = true; p.body.ring.visible = true; p.task = null;
  if (!quiet) addLog(`${p.name} arrived`);
  if (p.helper) { cleanNext(p); return; }
  if (Math.random() < .25 && lockerTrip(p)) return;
  if (!goWork(p)) p.state = 'away';
}

/* ---------- Initial state: a live mid-morning ---------- */
function populate(n) {
  for (let i = 0; i < n; i++) {
    const p = makePerson(); if (!p) break;
    const onShift = sim.t >= p.arriveAt && sim.t < p.leaveAt;
    if (onShift && (usesAttendance() || Math.random() < .92)) seatNow(p); // clocked in means at their desk
    else if (onShift) p.arriveAt = rnd(sim.t + 1, sim.t + 40); // running late
  }
}


function initDay() {
  populate(roster.list ? roster.list.length + 1 : 40); // everyone on the staff list (as many as there are desks), then Kasane Teto if a desk is left
  { const h = makeHelper(); if (sim.t >= h.arriveAt && sim.t < h.leaveAt) seatNow(h); } // our helper, cleaning
  // kick things off mid-morning (working hours, so no games): a training, a sync, a call, coffee and a whiteboard discussion
  // (only if the day starts during office hours)
  if (sim.t > 9 * 60 + 15 && sim.t < 17 * 60) {
    const here = () => shuffle(people.filter(p => p.state === 'doing' && p.task.kind === 'work'));
    const meet = (room, n, topic, mins) => {
      const m = { room, start: sim.t, end: sim.t + mins, members: [], speaker: null, swap: 0, topic };
      const seats = interactables.conf(room);
      here().slice(0, n).forEach((p, i) => { placeNow(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: seats[i], until: m.end, meeting: m, onStart: q => q.meeting = m, onEnd: q => q.meeting = null }); m.members.push(p); });
      meetings.push(m); addLog(`${topic[0].toUpperCase() + topic.slice(1)} started in Conference ${room} (${m.members.length})`);
    };
    meet(1, 6, 'training session', 30); meet(3, 4, 'client sync', 22);
    const a = here()[0]; if (a) placeNow(a, { kind: 'phone', cat: 'phone', anim: 'phone', spot: interactables.of('booth')[1], dur: 12, onStart: q => q.body.phone.visible = true, onEnd: q => q.body.phone.visible = false });
    const b = here()[0]; if (b) placeNow(b, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: interactables.of('counter')[0], dur: 5, onStart: q => { q.coffees++; q.body.mug.visible = true; }, onEnd: q => q.body.mug.visible = false });
    const c = here()[0]; if (c) placeNow(c, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: interactables.of('bar')[0], dur: 6, onStart: q => q.body.mug.visible = true, onEnd: q => q.body.mug.visible = false });
    whiteboard(here()[0]);
    here().slice(0, 3).forEach(p => { p.until = sim.t + rnd(.2, 2); });
  }
}

export { arriveNow, initDay, newDay, phaseName, resetDay };
