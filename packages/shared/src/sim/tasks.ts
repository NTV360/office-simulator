import { findPath } from '../nav/astar';
import { toPx } from '../plan';
import { random, rnd, shuffle } from '../util';
import { Vec3 } from '../vec3';
import { walkPx } from '../nav/grid';
import { interactables, type Spot } from './interactables';
import { addLog, people, sim } from './state';
import { exitSpot } from './spots';
import type { Person, Task, TaskSpot } from './types';

/* ---------- Tasks ---------- */
export function endTask(p: Person): void {
  const t = p.task; if (!t || t.ended) return;
  t.ended = true;
  if (t.onEnd) t.onEnd(p);
  if (t.spot && t.spot.shared && t.spot.occupant === p) t.spot.occupant = null;
}
export function goDo(p: Person, task: Task): boolean {
  const spot = task.spot;
  if (spot.shared && spot.occupant && spot.occupant !== p) return false;
  const path = findPath(p.pos, spot.approach);
  if (!path) return false;
  endTask(p);
  if (spot.shared) spot.occupant = p;
  if (spot.pos.distanceTo(spot.approach) > .01) path.push(spot.pos.clone());
  p.task = task; p.path = path; p.pi = 0; p.state = 'walking';
  return true;
}
export function placeNow(p: Person, task: Task): void {
  endTask(p); const s = task.spot; if (s.shared) s.occupant = p;
  p.task = task; p.pos.copy(s.pos); p.face = p.faceGoal = s.face; arrive(p);
}
export function arrive(p: Person): void {
  const t = p.task!; p.state = 'doing'; p.path = null;
  p.pos.copy(t.spot.pos); p.faceGoal = t.spot.face;
  p.until = t.until ?? sim.t + (t.dur ?? 0);
  if (t.onStart) t.onStart(p);
}
const free = (list: Spot[]): Spot[] => shuffle(list.filter(s => !s.occupant));

export function goWork(p: Person): boolean { return goDo(p, { kind: 'work', cat: 'work', anim: 'type', spot: p.slot!, dur: Math.max(4, Math.min(rnd(16, 48), p.leaveAt - sim.t + 2)) }); }
function coffee(p: Person): boolean {
  const s = free(interactables.of('counter'))[0]; if (!s) return false;
  const ok = goDo(p, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: s, dur: rnd(2, 4), onStart: q => { q.coffees++; q.props.mug = true; }, onEnd: q => { q.props.mug = false; } });
  if (ok && random() < .5) p.queue.push('bar');
  if (ok && random() < .3) p.queue.push('sink');
  return ok;
}
function sinkTrip(p: Person): boolean { const s = free(interactables.of('sink'))[0]; return !!s && goDo(p, { kind: 'sink', cat: 'pantry', anim: 'sink', spot: s, dur: rnd(1.5, 3) }); }
export function lockerTrip(p: Person): boolean { const s = free(interactables.of('locker'))[0]; return !!s && goDo(p, { kind: 'locker', cat: 'break', anim: 'locker', spot: s, dur: rnd(1, 2.5) }); }
function sofaBreak(p: Person): boolean { const s = free(interactables.of('lounge').filter(x => !x.game))[0]; return !!s && goDo(p, { kind: 'sofa', cat: 'break', anim: 'relax', spot: s, dur: rnd(6, 13) }); }
function musicBreak(p: Person): boolean {
  const s = free(interactables.of('music'))[0]; if (!s) return false;
  const g = s.kind === 'guitar';
  return goDo(p, { kind: s.kind, cat: 'break', anim: s.kind, spot: s, dur: rnd(6, 14), onStart: q => { if (g) q.props.guitar = true; }, onEnd: q => { q.props.guitar = false; } });
}
function dartsBreak(p: Person): boolean {
  const s = free(interactables.of('darts'))[0]; if (!s) return false;
  return goDo(p, { kind: 'darts', cat: 'break', anim: 'darts', spot: s, dur: rnd(6, 12) });
}
function golfBreak(p: Person): boolean {
  const s = free(interactables.of('golf'))[0]; if (!s) return false;
  return goDo(p, { kind: 'golf', cat: 'break', anim: 'putt', spot: s, dur: rnd(6, 12), onStart: q => { q.props.putter = true; }, onEnd: q => { q.props.putter = false; } });
}
function gameBreak(p: Person): boolean {
  const s = free(interactables.of('lounge').filter(x => x.game))[0]; if (!s) return false;
  return goDo(p, { kind: 'game', cat: 'break', anim: 'game', spot: s, dur: rnd(8, 18), onStart: q => { q.props.pad = true; }, onEnd: q => { q.props.pad = false; } });
}
function storageTrip(p: Person): boolean { const s = free(interactables.of('storage'))[0]; return !!s && goDo(p, { kind: 'storage', cat: 'break', anim: 'locker', spot: s, dur: rnd(1.5, 3) }); }
function barTrip(p: Person): boolean { const s = free(interactables.of('bar'))[0]; return !!s && goDo(p, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: s, dur: rnd(4, 9), onStart: q => { q.props.mug = true; }, onEnd: q => { q.props.mug = false; } }); }
function booth(p: Person): boolean {
  const s = free(interactables.of('booth'))[0]; if (!s) return false;
  return goDo(p, { kind: 'phone', cat: 'phone', anim: 'phone', spot: s, dur: rnd(7, 18), onStart: q => { q.props.phone = true; }, onEnd: q => { q.props.phone = false; } });
}
function chat(p: Person): boolean {
  const cands = shuffle(people.filter(q => q !== p && q.state === 'doing' && q.task?.kind === 'work' && !q.chatWith));
  cands.sort((a, b) => (a.slot!.place === p.slot!.place ? 0 : 1) - (b.slot!.place === p.slot!.place ? 0 : 1));
  for (const q of cands.slice(0, 4)) {
    const f = q.slot!.face, back = [-Math.sin(f), -Math.cos(f)], side = [Math.cos(f), -Math.sin(f)];
    for (const sd of shuffle([1, -1])) {
      const v = new Vec3(q.slot!.pos.x + back[0] * .62 + side[0] * .42 * sd, 0, q.slot!.pos.z + back[1] * .62 + side[1] * .42 * sd);
      if (!walkPx(...toPx(v))) continue;
      const spot: TaskSpot = { kind: 'chat', pos: v, approach: v, face: Math.atan2(q.pos.x - v.x, q.pos.z - v.z), shared: false, place: `${q.slot!.place}` };
      const ok = goDo(p, { kind: 'chat', cat: 'chat', anim: 'talkStand', spot, dur: rnd(3, 8), partner: q,
        onStart: me => { if (q.state === 'doing' && q.task?.kind === 'work') q.chatWith = me; },
        onEnd: me => { if (q.chatWith === me) q.chatWith = null; } });
      if (ok) return true;
    }
  }
  return false;
}
function lunch(p: Person): boolean {
  const d = free(interactables.of('dining'))[0];
  if (d && random() < .75) {
    if (random() < .35 && lockerTrip(p)) { p.queue.push('dining'); return true; }
    return goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) });
  }
  const s = free(interactables.of('lounge').filter(x => !x.game))[0];
  if (s && random() < .5) return goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: s, dur: rnd(20, 30) });
  return goDo(p, { kind: 'lunchDesk', cat: 'lunch', anim: 'eat', spot: p.slot!, dur: rnd(20, 30) });
}
function leave(p: Person): void {
  if (random() < .3 && !p.queue.includes('exit') && lockerTrip(p)) { p.queue.push('exit'); return; }
  goExit(p);
}
function goExit(p: Person): void {
  const door = exitSpot();
  if (!door || !goDo(p, { kind: 'exit', cat: 'walk', anim: 'stand', spot: door, dur: 0, onStart: q => { q.state = 'away'; q.shown = false; q.task = null; addLog(`${q.name} headed home`); } })) {
    p.state = 'away'; p.shown = false;
  }
}
function runQueued(p: Person, k: string | undefined): boolean {
  if (k === 'sink') return sinkTrip(p);
  if (k === 'bar') return barTrip(p);
  if (k === 'exit') { goExit(p); return true; }
  if (k === 'dining') { const d = free(interactables.of('dining'))[0]; return !!d && goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) }); }
  return false;
}
export function chooseNext(p: Person): void {
  while (p.queue.length) { if (runQueued(p, p.queue.shift())) return; }
  const t = sim.t;
  if (t >= p.leaveAt) return leave(p);
  if (!p.hadLunch && t >= p.lunchAt && t < 14 * 60) { p.hadLunch = true; if (lunch(p)) return; }
  if (p.task && p.task.kind !== 'work') { if (goWork(p)) return; }
  const r = random();
  if (r < .14 && coffee(p)) return;
  if (r < .25 && chat(p)) return;
  if (r < .31 && booth(p)) return;
  if (r < .35 && sofaBreak(p)) return;
  if (r < .38 && lockerTrip(p)) return;
  if (r < .41 && sinkTrip(p)) return;
  if (r < .44 && storageTrip(p)) return;
  if (r < .49 && gameBreak(p)) return;
  if (r < .53 && golfBreak(p)) return;
  if (r < .57 && dartsBreak(p)) return;
  if (r < .61 && musicBreak(p)) return;
  if (interactables.of('music').some(x => x.occupant) && random() < .05 && musicBreak(p)) return;
  if (interactables.of('darts').some(x => x.occupant) && random() < .07 && dartsBreak(p)) return;
  if (interactables.of('golf').some(x => x.occupant) && random() < .06 && golfBreak(p)) return;
  { const gamers = people.filter(q => q.task?.kind === 'game').length; if (gamers > 0 && gamers < 4 && random() < .07 && gameBreak(p)) return; }
  if (p.task?.kind === 'work' && p.state === 'doing') { p.until = sim.t + rnd(10, 35); return; }
  if (!goWork(p)) { p.until = sim.t + 1; }
}
