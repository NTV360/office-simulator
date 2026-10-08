import * as THREE from 'three';
import { toPx } from '../config/plan.js';
import { rnd, shuffle } from '../core/util.js';
import { findPath } from '../nav/astar.js';
import { walkPx } from '../nav/grid.js';
import { addLog, people, sim } from './state.js';
import { EXIT } from '../world/entrance.js';
import { SEATS } from '../world/furniture/basics.js';

/* ---------- Tasks ---------- */
function endTask(p) {
  const t = p.task; if (!t || t.ended) return;
  t.ended = true;
  if (t.onEnd) t.onEnd(p);
  if (t.spot && t.spot.shared && t.spot.occupant === p) t.spot.occupant = null;
}
function goDo(p, task) {
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
function placeNow(p, task) {
  endTask(p); const s = task.spot; if (s.shared) s.occupant = p;
  p.task = task; p.pos.copy(s.pos); p.face = p.faceGoal = s.face; arrive(p);
}
function arrive(p) {
  const t = p.task; p.state = 'doing'; p.path = null;
  p.pos.copy(t.spot.pos); p.faceGoal = t.spot.face;
  p.until = t.until ?? sim.t + (t.dur ?? 0);
  if (t.onStart) t.onStart(p);
}
const free = list => shuffle(list.filter(s => !s.occupant));

function goWork(p) { return goDo(p, { kind: 'work', cat: 'work', anim: 'type', spot: p.seat, dur: Math.max(4, Math.min(rnd(16, 48), p.leaveAt - sim.t + 2)) }); }
function coffee(p) {
  const s = free(SEATS.counter)[0]; if (!s) return false;
  const ok = goDo(p, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: s, dur: rnd(2, 4), onStart: q => { q.coffees++; q.body.mug.visible = true; }, onEnd: q => { q.body.mug.visible = false; } });
  if (ok && Math.random() < .5) p.queue.push('bar');
  if (ok && Math.random() < .3) p.queue.push('sink');
  return ok;
}
function sinkTrip(p) { const s = free(SEATS.sink)[0]; return !!s && goDo(p, { kind: 'sink', cat: 'pantry', anim: 'sink', spot: s, dur: rnd(1.5, 3) }); }
function lockerTrip(p) { const s = free(SEATS.locker)[0]; return !!s && goDo(p, { kind: 'locker', cat: 'break', anim: 'locker', spot: s, dur: rnd(1, 2.5) }); }
function sofaBreak(p) { const s = free(SEATS.lounge.filter(x => !x.game))[0]; return !!s && goDo(p, { kind: 'sofa', cat: 'break', anim: 'relax', spot: s, dur: rnd(6, 13) }); }
function dartsBreak(p) {
  const s = free(SEATS.darts)[0]; if (!s) return false;
  return goDo(p, { kind: 'darts', cat: 'break', anim: 'darts', spot: s, dur: rnd(6, 12) });
}
function golfBreak(p) {
  const s = free(SEATS.golf)[0]; if (!s) return false;
  return goDo(p, { kind: 'golf', cat: 'break', anim: 'putt', spot: s, dur: rnd(6, 12), onStart: q => q.body.putter.visible = true, onEnd: q => q.body.putter.visible = false });
}
function gameBreak(p) {
  const s = free(SEATS.lounge.filter(x => x.game))[0]; if (!s) return false;
  return goDo(p, { kind: 'game', cat: 'break', anim: 'game', spot: s, dur: rnd(8, 18), onStart: q => q.body.pad.visible = true, onEnd: q => q.body.pad.visible = false });
}
function storageTrip(p) { const s = free(SEATS.storage)[0]; return !!s && goDo(p, { kind: 'storage', cat: 'break', anim: 'locker', spot: s, dur: rnd(1.5, 3) }); }
function barTrip(p) { const s = free(SEATS.bar)[0]; return !!s && goDo(p, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: s, dur: rnd(4, 9), onStart: q => q.body.mug.visible = true, onEnd: q => q.body.mug.visible = false }); }
function booth(p) {
  const s = free(SEATS.booth)[0]; if (!s) return false;
  return goDo(p, { kind: 'phone', cat: 'phone', anim: 'phone', spot: s, dur: rnd(7, 18), onStart: q => q.body.phone.visible = true, onEnd: q => q.body.phone.visible = false });
}
function chat(p) {
  const cands = shuffle(people.filter(q => q !== p && q.state === 'doing' && q.task?.kind === 'work' && !q.chatWith));
  cands.sort((a, b) => (a.seat.place === p.seat.place ? 0 : 1) - (b.seat.place === p.seat.place ? 0 : 1));
  for (const q of cands.slice(0, 4)) {
    const f = q.seat.face, back = [-Math.sin(f), -Math.cos(f)], side = [Math.cos(f), -Math.sin(f)];
    for (const sd of shuffle([1, -1])) {
      const v = new THREE.Vector3(q.seat.pos.x + back[0] * .62 + side[0] * .42 * sd, 0, q.seat.pos.z + back[1] * .62 + side[1] * .42 * sd);
      if (!walkPx(...toPx(v))) continue;
      const spot = { kind: 'chat', pos: v, approach: v, face: Math.atan2(q.pos.x - v.x, q.pos.z - v.z), shared: false, place: `${q.seat.place}` };
      const ok = goDo(p, { kind: 'chat', cat: 'chat', anim: 'talkStand', spot, dur: rnd(3, 8), partner: q,
        onStart: me => { if (q.state === 'doing' && q.task?.kind === 'work') q.chatWith = me; },
        onEnd: me => { if (q.chatWith === me) q.chatWith = null; } });
      if (ok) return true;
    }
  }
  return false;
}
function lunch(p) {
  const d = free(SEATS.dining)[0];
  if (d && Math.random() < .75) {
    if (Math.random() < .35 && lockerTrip(p)) { p.queue.push('dining'); return true; }
    return goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) });
  }
  const s = free(SEATS.lounge.filter(x => !x.game))[0];
  if (s && Math.random() < .5) return goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: s, dur: rnd(20, 30) });
  return goDo(p, { kind: 'lunchDesk', cat: 'lunch', anim: 'eat', spot: p.seat, dur: rnd(20, 30) });
}
function leave(p) {
  if (Math.random() < .3 && !p.queue.includes('exit') && lockerTrip(p)) { p.queue.push('exit'); return; }
  goExit(p);
}
function goExit(p) {
  if (!goDo(p, { kind: 'exit', cat: 'walk', anim: 'stand', spot: EXIT, dur: 0, onStart: q => { q.state = 'away'; q.body.root.visible = false; q.body.ring.visible = false; q.task = null; addLog(`${q.name} headed home`); } })) {
    p.state = 'away'; p.body.root.visible = false; p.body.ring.visible = false;
  }
}
function runQueued(p, k) {
  if (k === 'sink') return sinkTrip(p);
  if (k === 'bar') return barTrip(p);
  if (k === 'exit') { goExit(p); return true; }
  if (k === 'dining') { const d = free(SEATS.dining)[0]; return !!d && goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) }); }
  return false;
}
function chooseNext(p) {
  while (p.queue.length) { if (runQueued(p, p.queue.shift())) return; }
  const t = sim.t;
  if (t >= p.leaveAt) return leave(p);
  if (!p.hadLunch && t >= p.lunchAt && t < 14 * 60) { p.hadLunch = true; if (lunch(p)) return; }
  if (p.task && p.task.kind !== 'work') { if (goWork(p)) return; }
  const r = Math.random();
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
  if (SEATS.darts.some(x => x.occupant) && Math.random() < .07 && dartsBreak(p)) return;
  if (SEATS.golf.some(x => x.occupant) && Math.random() < .06 && golfBreak(p)) return;
  { const gamers = people.filter(q => q.task?.kind === 'game').length; if (gamers > 0 && gamers < 4 && Math.random() < .07 && gameBreak(p)) return; }
  if (p.task?.kind === 'work' && p.state === 'doing') { p.until = sim.t + rnd(10, 35); return; }
  if (!goWork(p)) { p.until = sim.t + 1; }
}

export { arrive, chooseNext, endTask, goDo, goWork, lockerTrip, placeNow };
