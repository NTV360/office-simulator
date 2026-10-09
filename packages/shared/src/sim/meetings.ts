import { pick, random, rnd, shuffle } from '../util';
import { interactables } from './interactables';
import { isAi } from './person';
import { addLog, meetings, people, sim } from './state';
import { goDo } from './tasks';
import type { Meeting } from './types';

/* ---------- Meetings ---------- */
const TOPICS = ['sprint planning', 'design review', 'client sync', 'bug triage', 'release check-in', 'stand-up', 'retro', '1:1'];
export function tryMeeting(): void {
  const t = sim.t; if (t < 9 * 60 + 15 || t > 17 * 60 + 10) return;
  const lunchHour = t > 12 * 60 && t < 13 * 60;
  for (const room of shuffle([1, 2, 3])) {
    if (meetings.some(m => m.room === room)) continue;
    if (random() > (lunchHour ? .01 : .05)) continue;
    const cap = interactables.conf(room).length;
    const n = room === 2 ? 2 + Math.floor(random() * 4) : 3 + Math.floor(random() * 6);
    const pool = shuffle(people.filter(p => isAi(p) && p.state !== 'away' && !p.meeting && p.leaveAt - t > 50 && p.task && ['work', 'coffee', 'chat', 'sofa', 'sink', 'bar'].includes(p.task.kind)));
    if (pool.length < n) continue;
    const topic = n === 2 ? '1:1' : room === 1 ? pick(['training session', 'demo day', 'sprint review', 'all-hands']) : pick(TOPICS.filter(x => x !== '1:1'));
    const m: Meeting = { room, start: t, end: t + rnd(18, 45), members: [], speaker: null, swap: 0, topic };
    const seats = shuffle(interactables.conf(room).slice());
    for (const p of pool.slice(0, Math.min(n, cap))) {
      const s = seats.pop()!;
      if (goDo(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: s, until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } })) m.members.push(p);
    }
    if (m.members.length >= 2) { meetings.push(m); addLog(`${m.members[0].name.split(' ')[0]} started a ${m.topic} in Conference ${room} (${m.members.length})`); }
    else m.members.forEach(p => { p.until = sim.t; });
  }
}
export function tickMeetings(): void {
  for (let i = meetings.length - 1; i >= 0; i--) {
    const m = meetings[i];
    if (sim.t >= m.end) { meetings.splice(i, 1); continue; }
    const seated = m.members.filter(p => p.state === 'doing' && p.task?.meeting === m);
    if (!m.speaker || sim.t >= m.swap || !seated.includes(m.speaker)) { m.speaker = seated.length ? pick(seated) : null; m.swap = sim.t + rnd(1, 3.5); }
  }
}
export { meetings };
