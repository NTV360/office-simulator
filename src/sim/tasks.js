import * as THREE from 'three';
import { toPx } from '../config/plan.js';
import { rnd, shuffle } from '../core/util.js';
import { findPath } from '../nav/astar.js';
import { walkPx } from '../nav/grid.js';
import { onBreak } from './schedule.js';
import { addLog, people, sim } from './state.js';
import { ENTRY, EXIT } from '../world/entrance.js';
import { BUCKET } from '../world/furniture/kitchen.js';
import { interactables } from '../world/interactables.js';

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
  const s = free(interactables.of('counter'))[0]; if (!s) return false;
  const ok = goDo(p, { kind: 'coffee', cat: 'pantry', anim: 'drink', spot: s, dur: rnd(2, 4), onStart: q => { q.coffees++; q.body.mug.visible = true; }, onEnd: q => { q.body.mug.visible = false; } });
  if (ok && Math.random() < .5) p.queue.push('bar');
  if (ok && Math.random() < .3) p.queue.push('sink');
  return ok;
}
function sinkTrip(p) { const s = free(interactables.of('sink'))[0]; return !!s && goDo(p, { kind: 'sink', cat: 'pantry', anim: 'sink', spot: s, dur: rnd(1.5, 3) }); }
function lockerTrip(p) { const s = free(interactables.of('locker'))[0]; return !!s && goDo(p, { kind: 'locker', cat: 'break', anim: 'locker', spot: s, dur: rnd(1, 2.5) }); }
function sofaBreak(p) { const s = free(interactables.of('lounge').filter(x => !x.game))[0]; return !!s && goDo(p, { kind: 'sofa', cat: 'break', anim: 'relax', spot: s, dur: rnd(6, 13) }); }
function musicBreak(p) {
  const s = free(interactables.of('music'))[0]; if (!s) return false;
  const g = s.kind === 'guitar';
  return goDo(p, { kind: s.kind, cat: 'break', anim: s.kind, spot: s, dur: rnd(6, 14), onStart: q => { if (g) q.body.guitar.visible = true; }, onEnd: q => { q.body.guitar.visible = false; } });
}
function dartsBreak(p) {
  const s = free(interactables.of('darts'))[0]; if (!s) return false;
  return goDo(p, { kind: 'darts', cat: 'break', anim: 'darts', spot: s, dur: rnd(6, 12) });
}
function golfBreak(p) {
  const s = free(interactables.of('golf'))[0]; if (!s) return false;
  return goDo(p, { kind: 'golf', cat: 'break', anim: 'putt', spot: s, dur: rnd(6, 12), onStart: q => q.body.putter.visible = true, onEnd: q => q.body.putter.visible = false });
}
function gameBreak(p) {
  const s = free(interactables.of('lounge').filter(x => x.game))[0]; if (!s) return false;
  return goDo(p, { kind: 'game', cat: 'break', anim: 'game', spot: s, dur: rnd(8, 18), onStart: q => q.body.pad.visible = true, onEnd: q => q.body.pad.visible = false });
}
function storageTrip(p) { const s = free(interactables.of('storage'))[0]; return !!s && goDo(p, { kind: 'storage', cat: 'break', anim: 'locker', spot: s, dur: rnd(1.5, 3) }); }
function barTrip(p) { const s = free(interactables.of('bar'))[0]; return !!s && goDo(p, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: s, dur: rnd(4, 9), onStart: q => q.body.mug.visible = true, onEnd: q => q.body.mug.visible = false }); }
function booth(p) {
  const s = free(interactables.of('booth'))[0]; if (!s) return false;
  return goDo(p, { kind: 'phone', cat: 'phone', anim: 'phone', spot: s, dur: rnd(7, 18), onStart: q => q.body.phone.visible = true, onEnd: q => q.body.phone.visible = false });
}
// "Deploying to the toilet": run to the green bucket by the counter, grab it and run out of the office.
// They come back a few minutes later (see returnFromToilet), put the bucket back and get back to work.
function bucketRun(p) {
  const s = interactables.of('bucket')[0]; if (!s || s.occupant || BUCKET.carrier) return false;
  const ok = goDo(p, { kind: 'bucket', cat: 'walk', anim: 'stand', spot: s, dur: .3, run: true, onStart: q => {
    BUCKET.carrier = q; BUCKET.mesh.visible = false; q.body.bucket.visible = true;
    addLog(`${q.name} is Deploying to the toilet`);
  } });
  if (ok) p.queue.push('toilet');
  return ok;
}
function toiletExit(p) {
  return goDo(p, { kind: 'toilet', cat: 'walk', anim: 'stand', spot: EXIT, dur: 0, run: true, onStart: q => {
    endTask(q); q.state = 'away'; q.task = null; q.body.root.visible = false; q.body.ring.visible = false;
    q.toiletUntil = sim.t + rnd(5, 11);
  } });
}
// Back in through the front door, bucket in hand, to put it back.
function returnFromToilet(p) {
  p.toiletUntil = null; p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI;
  p.body.root.visible = true; p.body.ring.visible = true;
  const s = interactables.of('bucket')[0];
  if (!goDo(p, { kind: 'bucketBack', cat: 'walk', anim: 'stand', spot: s, dur: .3, onStart: putBucketBack })) putBucketBack(p);
}
function putBucketBack(p) {
  p.body.bucket.visible = false; if (BUCKET.carrier === p) BUCKET.carrier = null; BUCKET.mesh.visible = true;
}

// Grab a snack from the cabinet above the sink, then eat it back at the desk.
function snack(p) {
  const s = free(interactables.of('snack'))[0]; if (!s) return false;
  const ok = goDo(p, { kind: 'snack', cat: 'pantry', anim: 'locker', spot: s, dur: rnd(1, 2) });
  if (ok) p.queue.push('snackDesk');
  return ok;
}
// Start a discussion at a free whiteboard with one or two colleagues who are at their desks.
function whiteboard(p) {
  if (!p) return false;
  const boards = shuffle([...new Set(interactables.of('whiteboard').map(s => s.group))]);
  const group = boards.find(g => interactables.of(g).every(s => !s.occupant)); if (!group) return false;
  const [lead, ...rest] = interactables.of(group);
  const mates = shuffle(people.filter(q => q !== p && q.state === 'doing' && q.task?.kind === 'work' && !q.chatWith && !q.meeting))
    .sort((a, b) => (a.department && a.department === p.department ? 0 : 1) - (b.department && b.department === p.department ? 0 : 1))
    .slice(0, 1 + Math.floor(Math.random() * 2));
  if (!mates.length) return false;
  const until = sim.t + rnd(10, 22);
  if (!goDo(p, { kind: 'whiteboard', cat: 'meeting', anim: 'present', spot: lead, until })) return false;
  mates.forEach((q, i) => goDo(q, { kind: 'whiteboard', cat: 'meeting', anim: 'talkStand', spot: rest[i], until, partner: p }));
  addLog(`${p.name.split(' ')[0]} started a whiteboard discussion`);
  return true;
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
  const d = free(interactables.of('dining'))[0];
  if (d && Math.random() < .75) {
    if (Math.random() < .35 && lockerTrip(p)) { p.queue.push('dining'); return true; }
    return goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) });
  }
  const s = free(interactables.of('lounge').filter(x => !x.game))[0];
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
  if (k === 'toilet') { if (!toiletExit(p)) returnFromToilet(p); return true; }
  if (k === 'snackDesk') return goDo(p, { kind: 'snackDesk', cat: 'pantry', anim: 'eat', spot: p.seat, dur: rnd(3, 7) });
  if (k === 'dining') { const d = free(interactables.of('dining'))[0]; return !!d && goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) }); }
  return false;
}
// What someone does next. During their shift: work, plus meetings (sim/meetings.js), whiteboard
// discussions, chats at desks, calls in the booths, coffee and snacks. Games, music, darts, golf and the
// sofa only during their breaks (the lunch hour, 15:00 and 17:00 for the day shift; see sim/schedule.js).
function chooseNext(p) {
  while (p.queue.length) { if (runQueued(p, p.queue.shift())) return; }
  const t = sim.t;
  if (t >= p.leaveAt) return leave(p);
  if (!p.hadLunch && t >= p.lunchAt && t < p.lunchAt + 90) { p.hadLunch = true; if (lunch(p)) return; }
  if (onBreak(p, t)) { if (play(p)) return; }
  else if (p.task && p.task.kind !== 'work') { if (goWork(p)) return; }
  else if (work(p)) return;
  if (p.task?.kind === 'work' && p.state === 'doing') { p.until = sim.t + rnd(10, 35); return; }
  if (!goWork(p)) { p.until = sim.t + 1; }
}
// Working hours: mostly staying at the desk, sometimes an errand that is part of work.
function work(p) {
  const r = Math.random();
  if (r < .06) return coffee(p);
  if (r < .10) return snack(p);
  if (r < .17) return chat(p);
  if (r < .22) return booth(p);
  if (r < .26) return whiteboard(p);
  if (r < .28) return sinkTrip(p);
  if (r < .30) return storageTrip(p);
  if (r < .31) return bucketRun(p);
  return false;
}
// Breaks: everybody plays. Joining a game or a group that is already going is likely; when the games are
// full, people take whatever is free (the bar table, coffee, a snack, a chat) instead of going back to work.
function play(p) {
  if (interactables.of('darts').some(x => x.occupant) && Math.random() < .3 && dartsBreak(p)) return true;
  if (interactables.of('golf').some(x => x.occupant) && Math.random() < .3 && golfBreak(p)) return true;
  { const gamers = people.filter(q => q.task?.kind === 'game').length; if (gamers > 0 && gamers < 4 && Math.random() < .35 && gameBreak(p)) return true; }
  const games = shuffle([gameBreak, golfBreak, dartsBreak, musicBreak, sofaBreak]), rest = shuffle([barTrip, coffee, snack, chat]);
  return [...games, ...rest].some(f => f(p));
}

export { arrive, chooseNext, endTask, goDo, goWork, lockerTrip, placeNow, putBucketBack, returnFromToilet, whiteboard };
