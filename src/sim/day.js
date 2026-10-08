import { rnd, shuffle } from '../core/util.js';
import { exitFP, fp } from '../fp/firstPerson.js';
import { makePerson, scheduleDay } from '../people/factory.js';
import { meetings } from './meetings.js';
import { addLog, people, sim } from './state.js';
import { endTask, goWork, lockerTrip, placeNow } from './tasks.js';
import { ENTRY } from '../world/entrance.js';
import { SEATS } from '../world/furniture/basics.js';

/* ---------- Day cycle ---------- */
function phaseName(t) {
  if (t < 9 * 60) return 'Arrivals'; if (t < 12 * 60) return 'Morning focus'; if (t < 13 * 60 + 10) return 'Lunch hour';
  if (t < 17 * 60) return 'Afternoon work'; if (t < 18 * 60 + 50) return 'Wrapping up'; return 'Lights out';
}
function newDay() {
  if (fp.on) exitFP();
  sim.day++; sim.t = 7 * 60 + 45;
  meetings.length = 0;
  people.forEach(p => { endTask(p); p.queue = []; p.state = 'away'; p.task = null; p.chatWith = null; p.meeting = null; p.body.root.visible = false; p.body.ring.visible = false; scheduleDay(p); });
  addLog(`Day ${sim.day} begins`);
}
function arriveNow(p, quiet) {
  p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI; p.arrivedAt = sim.t;
  p.body.root.visible = true; p.body.ring.visible = true; p.task = null;
  if (!quiet) addLog(`${p.name} arrived`);
  if (Math.random() < .25 && lockerTrip(p)) return;
  if (!goWork(p)) p.state = 'away';
}

/* ---------- Initial state: a live mid-morning ---------- */
function populate(n) {
  for (let i = 0; i < n; i++) {
    const p = makePerson(); if (!p) break;
    if (i < n * .88) {
      p.arriveAt = rnd(8 * 60, 9 * 60 + 20); p.arrivedAt = p.arriveAt; p.body.root.visible = true; p.body.ring.visible = true;
      placeNow(p, { kind: 'work', cat: 'work', anim: 'type', spot: p.seat, dur: rnd(2, 40) });
    } else p.arriveAt = rnd(sim.t + 1, sim.t + 40);
  }
}
populate(40);
// kick things off: a training in Conference 1, a sync in Conference 2, calls, coffee and a break
{
  const here = () => shuffle(people.filter(p => p.state === 'doing' && p.task.kind === 'work'));
  const meet = (room, n, topic, mins) => {
    const m = { room, start: sim.t, end: sim.t + mins, members: [], speaker: null, swap: 0, topic };
    const seats = SEATS.conf[room];
    here().slice(0, n).forEach((p, i) => { placeNow(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: seats[i], until: m.end, meeting: m, onStart: q => q.meeting = m, onEnd: q => q.meeting = null }); m.members.push(p); });
    meetings.push(m); addLog(`${topic[0].toUpperCase() + topic.slice(1)} started in Conference ${room} (${m.members.length})`);
  };
  meet(1, 6, 'training session', 30); meet(2, 4, 'client sync', 22);
  const a = here()[0]; if (a) placeNow(a, { kind: 'phone', cat: 'phone', anim: 'phone', spot: SEATS.booth[1], dur: 12, onStart: q => q.body.phone.visible = true, onEnd: q => q.body.phone.visible = false });
  const b = here()[0]; if (b) placeNow(b, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: SEATS.counter[0], dur: 5, onStart: q => { q.coffees++; q.body.mug.visible = true; }, onEnd: q => q.body.mug.visible = false });
  const c = here()[0]; if (c) placeNow(c, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: SEATS.bar[0], dur: 6, onStart: q => q.body.mug.visible = true, onEnd: q => q.body.mug.visible = false });
  SEATS.darts.forEach((sp, i) => { const g = here()[0]; if (g) placeNow(g, { kind: 'darts', cat: 'break', anim: 'darts', spot: sp, dur: 10 + i * 2 }); });
  SEATS.golf.forEach((sp, i) => { const g = here()[0]; if (g) placeNow(g, { kind: 'golf', cat: 'break', anim: 'putt', spot: sp, dur: 9 + i * 3, onStart: q => q.body.putter.visible = true, onEnd: q => q.body.putter.visible = false }); });
  [5, 6, 7].forEach((k, i) => { const g = here()[0]; if (g) placeNow(g, { kind: 'game', cat: 'break', anim: 'game', spot: SEATS.lounge[k], dur: 14 + i * 3, onStart: q => q.body.pad.visible = true, onEnd: q => q.body.pad.visible = false }); });
  const d = here()[0]; if (d) placeNow(d, { kind: 'sofa', cat: 'break', anim: 'relax', spot: SEATS.lounge[10], dur: 10 });
  here().slice(0, 3).forEach(p => { p.until = sim.t + rnd(.2, 2); });
}

export { arriveNow, newDay, phaseName };
