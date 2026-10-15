import { pick, rnd, shuffle } from '../core/util.js';
import { onBreak } from './schedule.js';
import { addLog, people, sim } from './state.js';
import { goDo } from './tasks.js';
import { LESSONS } from '../render/screens.js';
import { showLesson } from '../world/furniture/conference.js';
import { interactables } from '../world/interactables.js';

/* ---------- Meetings ---------- */
const meetings = [];
// A coding class for Conference 1 (the classroom): which lesson (render/screens.js LESSONS) and its topic.
function newClass() { const lesson = Math.floor(Math.random() * LESSONS.length); return { lesson, topic: `${LESSONS[lesson].title} class` }; }
const TOPICS = ['sprint planning', 'design review', 'client sync', 'bug triage', 'release check-in', 'stand-up', 'retro', '1:1'];
function tryMeeting() {
  const t = sim.t; if (t < 9 * 60 + 15 || t > 17 * 60 + 10) return;
  const lunchHour = t > 12 * 60 && t < 13 * 60;
  for (const room of shuffle([1, 3])) { // room 2 is the HR office now
    if (meetings.some(m => m.room === room)) continue;
    if (Math.random() > (lunchHour ? .01 : .05)) continue;
    const cap = interactables.conf(room).length, classroom = room === 1;
    const n = classroom ? 4 + Math.floor(Math.random() * 6) : Math.random() < .2 ? 2 : 3 + Math.floor(Math.random() * 6);
    const pool = shuffle(people.filter(p => p.state !== 'away' && !p.meeting && !onBreak(p, t) && p.leaveAt - t > 50 && p.task && ['work', 'coffee', 'chat', 'snackDesk', 'sink'].includes(p.task.kind)));
    if (pool.length < n) continue;
    // Conference 1 is a classroom: a coding class (newClass), taught by someone standing at the front (a
    // developer if there is one), the lesson on the TV (showLesson)
    const { lesson = null, topic = n === 2 ? '1:1' : pick(TOPICS.filter(x => x !== '1:1')) } = classroom ? newClass() : {};
    const m = { room, start: t, end: t + rnd(25, 50), members: [], speaker: null, swap: 0, topic, lesson, teacher: null };
    if (classroom) {
      const teacher = pool.find(p => /dev|engineer/i.test(p.role)) ?? pool[0];
      pool.splice(pool.indexOf(teacher), 1);
      if (!goDo(teacher, { kind: 'meeting', cat: 'meeting', anim: 'present', spot: interactables.of('teach')[0], until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } })) continue;
      m.teacher = teacher; m.members.push(teacher);
    }
    const seats = shuffle(interactables.conf(room).slice());
    for (const p of pool.slice(0, Math.min(n - (classroom ? 1 : 0), cap))) {
      const s = seats.pop();
      if (goDo(p, { kind: 'meeting', cat: 'meeting', anim: 'listen', spot: s, until: m.end, meeting: m, onStart: q => { q.meeting = m; }, onEnd: q => { q.meeting = null; } })) m.members.push(p);
    }
    if (m.members.length >= (classroom ? 3 : 2)) { meetings.push(m); addLog(`${m.members[0].name.split(' ')[0]} started ${classroom ? 'teaching' : 'a'} ${m.topic} in Conference ${room} (${m.members.length})`); }
    else m.members.forEach(p => { p.until = sim.t; });
  }
}
function tickMeetings() {
  showLesson(meetings.find(m => m.lesson != null)?.lesson ?? null);
  for (let i = meetings.length - 1; i >= 0; i--) {
    const m = meetings[i];
    if (sim.t >= m.end) { meetings.splice(i, 1); continue; }
    const seated = m.members.filter(p => p.state === 'doing' && p.task?.meeting === m);
    if (m.teacher) { m.speaker = seated.includes(m.teacher) ? m.teacher : null; continue; } // the teacher does the talking
    if (!m.speaker || sim.t >= m.swap || !seated.includes(m.speaker)) { m.speaker = seated.length ? pick(seated) : null; m.swap = sim.t + rnd(1, 3.5); }
  }
}

export { meetings, newClass, tickMeetings, tryMeeting };
