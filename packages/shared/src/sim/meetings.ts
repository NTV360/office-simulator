import { pick, random, rnd, shuffle } from '../util';
import { seatUnusable } from '../world/objects';
import { interactables, type Spot } from './interactables';
import { LESSONS, classTopic } from './lessons';
import { isAi } from './person';
import { onBreak } from './schedule';
import { addLog, meetings, people, sim } from './state';
import { goDo } from './tasks';
import type { Meeting } from './types';

/** The seats of a conference room that can be used now (not one whose chair somebody is carrying). */
const confSeats = (room: number): Spot[] => interactables.conf(room).filter(s => !seatUnusable(s));

/* ---------- Meetings ---------- */
/** A coding class for Conference 1 (the classroom): which lesson (LESSONS) and its topic. */
export function newClass(): { lesson: number; topic: string } { const lesson = Math.floor(random() * LESSONS.length); return { lesson, topic: classTopic(lesson) }; }
const TOPICS = ['sprint planning', 'design review', 'client sync', 'bug triage', 'release check-in', 'stand-up', 'retro', '1:1'];
export function tryMeeting(): void {
  const t = sim.t; if (t < 9 * 60 + 15 || t > 17 * 60 + 10) return;
  const lunchHour = t > 12 * 60 && t < 13 * 60;
  // (room 2 is the HR office now, with desks instead of meeting seats: it holds no meetings)
  for (const room of shuffle([1, 3].filter(r => confSeats(r).length >= 2))) {
    if (meetings.some(m => m.room === room)) continue;
    if (random() > (lunchHour ? .01 : .05)) continue;
    const cap = confSeats(room).length, classroom = room === 1 && interactables.of('teach').length > 0;
    const n = classroom ? 4 + Math.floor(random() * 6) : random() < .2 ? 2 : 3 + Math.floor(random() * 6); // now and then just two people: a 1:1 (Conference 1 is the classroom: always a class)
    const pool = shuffle(people.filter(p => isAi(p) && p.state !== 'away' && !p.meeting && !onBreak(p, t) && p.leaveAt - t > 50 && p.task && ['work', 'coffee', 'chat', 'snackDesk', 'sink'].includes(p.task.kind)));
    if (pool.length < n) continue;
    // Conference 1 is a classroom: a coding class (newClass), taught by someone standing at the front (a developer if there is one), the lesson on the TV
    const { lesson = null, topic = n === 2 ? '1:1' : pick(TOPICS.filter(x => x !== '1:1')) } = classroom ? newClass() : {};
    const m: Meeting = { room, start: t, end: t + (classroom ? rnd(25, 50) : rnd(18, 45)), members: [], speaker: null, swap: 0, topic, lesson, teacher: null };
    if (classroom) {
      const teacher = pool.find(p => /dev|engineer/i.test(p.role)) ?? pool[0];
      pool.splice(pool.indexOf(teacher), 1);
      if (!goDo(teacher, { kind: 'meeting', cat: 'meeting', anim: 'present', spot: interactables.of('teach')[0], until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } })) continue;
      m.teacher = teacher; m.members.push(teacher);
    }
    const seats = shuffle(confSeats(room).slice());
    for (const p of pool.slice(0, Math.min(n - (classroom ? 1 : 0), cap))) {
      const s = seats.pop()!;
      if (goDo(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: s, until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } })) m.members.push(p);
    }
    if (m.members.length >= (classroom ? 3 : 2)) { meetings.push(m); addLog(`${m.members[0].name.split(' ')[0]} started ${classroom ? 'teaching' : 'a'} ${m.topic} in Conference ${room} (${m.members.length})`); }
    else m.members.forEach(p => { p.until = sim.t; });
  }
}
export function tickMeetings(): void {
  for (let i = meetings.length - 1; i >= 0; i--) {
    const m = meetings[i];
    if (sim.t >= m.end) { meetings.splice(i, 1); continue; }
    const seated = m.members.filter(p => p.state === 'doing' && p.task?.meeting === m);
    if (m.teacher) { m.speaker = seated.includes(m.teacher) ? m.teacher : null; continue; } // the teacher does the talking
    if (!m.speaker || sim.t >= m.swap || !seated.includes(m.speaker)) { m.speaker = seated.length ? pick(seated) : null; m.swap = sim.t + rnd(1, 3.5); }
  }
}
export { meetings };
