import { findPath } from '../nav/astar';
import { W, WINDOWS, toPx } from '../plan';
import { random, rnd, shuffle } from '../util';
import { Vec3 } from '../vec3';
import { walkPx } from '../nav/grid';
import { interactables, type Spot } from './interactables';
import { isHelper } from './person';
import { onBreak } from './schedule';
import { addLog, people, sim } from './state';
import { ENTRY, exitSpot } from './spots';
import type { Person, Task, TaskSpot } from './types';

/* ---------- Tasks ---------- */
export function endTask(p: Person): void {
  const t = p.task; if (!t || t.ended) return;
  t.ended = true;
  if (t.onEnd) t.onEnd(p);
  if (t.spot && t.spot.occupant === p) t.spot.occupant = null;
}
export function goDo(p: Person, task: Task): boolean {
  const spot = task.spot;
  if (spot.occupant && spot.occupant !== p) return false; // somebody is in it (a human at a desk counts too)
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
/** Watch the movie on the dining TV from a dining seat (breaks only). */
function tvBreak(p: Person): boolean {
  const s = free(interactables.of('dining')).sort((a, b) => a.pos.z - b.pos.z)[0]; // the rows nearest the TV first
  return !!s && goDo(p, { kind: 'tv', cat: 'break', anim: 'relax', spot: s, dur: rnd(8, 20) });
}
function storageTrip(p: Person): boolean { const s = free(interactables.of('storage'))[0]; return !!s && goDo(p, { kind: 'storage', cat: 'break', anim: 'locker', spot: s, dur: rnd(1.5, 3) }); }
function barTrip(p: Person): boolean { const s = free(interactables.of('bar'))[0]; return !!s && goDo(p, { kind: 'bar', cat: 'pantry', anim: 'drinkSit', spot: s, dur: rnd(4, 9), onStart: q => { q.props.mug = true; }, onEnd: q => { q.props.mug = false; } }); }
function booth(p: Person): boolean {
  const s = free(interactables.of('booth'))[0]; if (!s) return false;
  return goDo(p, { kind: 'phone', cat: 'phone', anim: 'phone', spot: s, dur: rnd(7, 18), onStart: q => { q.props.phone = true; }, onEnd: q => { q.props.phone = false; } });
}
// "Deploying to the toilet": run to the green bucket by the counter, grab it and run out of the office. They come back a few minutes
// later (see returnFromToilet), put the bucket back and get back to work. Only one bucket: whoever holds it (in hand, or out of the
// building with it) is the only one who can be on the run.
const bucketTaken = (): boolean => people.some(q => q.props.bucket && q.controller === 'ai');
export function bucketRun(p: Person): boolean {
  const s = interactables.of('bucket')[0]; if (!s || s.occupant || bucketTaken()) return false;
  const ok = goDo(p, { kind: 'bucket', cat: 'walk', anim: 'stand', spot: s, dur: .3, run: true, onStart: q => {
    q.props.bucket = true;
    addLog(`${q.name} is Deploying to the toilet`);
  } });
  if (ok) p.queue.push('toilet');
  return ok;
}
function toiletExit(p: Person): boolean {
  const door = exitSpot(); if (!door) return false;
  return goDo(p, { kind: 'toilet', cat: 'walk', anim: 'stand', spot: door, dur: 0, run: true, onStart: q => {
    endTask(q); q.state = 'away'; q.task = null; q.shown = false;
    q.toiletUntil = sim.t + rnd(5, 11);
  } });
}
/** Back in through the front door, bucket in hand, to put it back. */
export function returnFromToilet(p: Person): void {
  p.toiletUntil = null; p.state = 'idle'; p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI;
  p.shown = true;
  const s = interactables.of('bucket')[0];
  if (!s || !goDo(p, { kind: 'bucketBack', cat: 'walk', anim: 'stand', spot: s, dur: .3, onStart: putBucketBack })) putBucketBack(p);
}
export function putBucketBack(p: Person): void { p.props.bucket = false; }

// Grab a snack from the cabinet above the sink, then eat it back at the desk.
function snack(p: Person): boolean {
  const s = free(interactables.of('snack'))[0]; if (!s) return false;
  const ok = goDo(p, { kind: 'snack', cat: 'pantry', anim: 'locker', spot: s, dur: rnd(1, 2) });
  if (ok) p.queue.push('snackDesk');
  return ok;
}
/** Start a discussion at a free whiteboard with one or two colleagues who are at their desks. */
export function whiteboard(p: Person | undefined): boolean {
  if (!p) return false;
  const boards = shuffle([...new Set(interactables.of('whiteboard').map(s => s.group as string))]);
  const group = boards.find(g => interactables.of(g).every(s => !s.occupant)); if (!group) return false;
  const [lead, ...rest] = interactables.of(group);
  const mates = shuffle(people.filter(q => q !== p && q.state === 'doing' && q.task?.kind === 'work' && !q.chatWith && !q.meeting))
    .sort((a, b) => (a.department && a.department === p.department ? 0 : 1) - (b.department && b.department === p.department ? 0 : 1))
    .slice(0, 1 + Math.floor(random() * 2));
  if (!mates.length) return false;
  const until = sim.t + rnd(10, 22);
  if (!goDo(p, { kind: 'whiteboard', cat: 'meeting', anim: 'present', spot: lead, until })) return false;
  mates.forEach((q, i) => goDo(q, { kind: 'whiteboard', cat: 'meeting', anim: 'talkStand', spot: rest[i], until, partner: p }));
  addLog(`${p.name.split(' ')[0]} started a whiteboard discussion`);
  return true;
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
  if (k === 'toilet') { if (!toiletExit(p)) returnFromToilet(p); return true; }
  if (k === 'snackDesk') return goDo(p, { kind: 'snackDesk', cat: 'pantry', anim: 'eat', spot: p.slot!, dur: rnd(3, 7) });
  if (k === 'dining') { const d = free(interactables.of('dining'))[0]; return !!d && goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(22, 38) }); }
  return false;
}
/**
 * What someone does next. During their shift: work, plus meetings (sim/meetings.ts), whiteboard discussions, chats at desks, calls in the
 * booths, coffee and snacks. Games, music, darts, golf and the sofa only during their breaks (the lunch hour, 15:00 and 17:00 for the day
 * shift; see sim/schedule.ts).
 */
export function chooseNext(p: Person): void {
  while (p.queue.length) { if (runQueued(p, p.queue.shift())) return; }
  if (isHelper(p)) return cleanNext(p);
  const t = sim.t;
  if (t >= p.leaveAt) return leave(p);
  if (!p.hadLunch && t >= p.lunchAt && t < p.lunchAt + 90) { p.hadLunch = true; if (lunch(p)) return; }
  if (onBreak(p, t)) { if (play(p)) return; }
  else if (p.task && p.task.kind !== 'work') { if (goWork(p)) return; }
  else if (work(p)) return;
  if (p.task?.kind === 'work' && p.state === 'doing') { p.until = sim.t + rnd(10, 35); return; }
  if (!goWork(p)) { p.until = sim.t + 1; }
}
// ----- the helper (sim/helper.ts): she cleans all day -----
// Jobs: wipe a table (standing at one of its chairs), wipe a window (just inside an outer-wall window), mop a patch of open floor, organise
// the storage room or lockers. Each picks a real, walkable spot.
const CLEAN: Record<string, { anim: string; prop: 'rag' | 'mop' | null; weight: number }> = {
  table: { anim: 'wipe', prop: 'rag', weight: .35 },
  window: { anim: 'windowWipe', prop: 'rag', weight: .25 },
  floor: { anim: 'mop', prop: 'mop', weight: .25 },
  organize: { anim: 'locker', prop: null, weight: .15 },
};
const cleanAt = (px: number, py: number, face: number, place: string): TaskSpot => { const v = W(px, py); return { kind: 'clean', pos: v, approach: v, face, shared: false, place }; };
function cleanSpot(job: string): TaskSpot | null {
  if (job === 'table') {
    const s = shuffle(['conf', 'dining', 'bar'].flatMap(k => interactables.of(k)).filter(x => !x.occupant))[0];
    return s ?? null; // (the real chair: it is hers while she wipes, so nobody else is sent to the same place)
  }
  if (job === 'organize') return shuffle([...interactables.of('storage'), ...interactables.of('locker')].filter(x => !x.occupant))[0] ?? null;
  for (let i = 0; i < 12; i++) {
    if (job === 'window') {
      const [vert, line, a, b] = WINDOWS[Math.floor(random() * WINDOWS.length)], t = a + 6 + random() * (b - a - 12);
      // just inside the glass, facing it: east wall (x 682) faces east, north wall (y 71) faces north
      const [px, py, face] = vert ? [line - 14, t, Math.PI / 2] : [t, line + 14, Math.PI];
      if (walkPx(px, py)) return cleanAt(px, py, face, 'the windows');
    } else {
      const s = shuffle(interactables.of('desk'))[0], [x0, y0] = toPx(s.approach), px = x0 + (random() - .5) * 50, py = y0 + (random() - .5) * 50;
      if (walkPx(px, py)) return cleanAt(px, py, random() * Math.PI * 2, 'the floor');
    }
  }
  return null;
}
/** What the helper does next: lunch when it is time, else the next cleaning job (a little later if nothing is free). */
export function cleanNext(p: Person): void {
  const t = sim.t;
  if (t >= p.leaveAt) return leave(p);
  if (!p.hadLunch && t >= p.lunchAt && t < p.lunchAt + 90) {
    const d = free(interactables.of('dining'))[0]; // (lunch counts as had only once she has a seat: the dining tables can all be taken)
    if (d && goDo(p, { kind: 'lunch', cat: 'lunch', anim: 'eat', spot: d, dur: rnd(20, 30) })) { p.hadLunch = true; return; }
  }
  let r = random(), job = 'table';
  for (const [k, c] of Object.entries(CLEAN)) { if (r < c.weight) { job = k; break; } r -= c.weight; }
  const spot = cleanSpot(job), c = CLEAN[job];
  const show = (q: Person, on: boolean): void => { if (c.prop) q.props[c.prop] = on; };
  if (spot && goDo(p, { kind: 'clean', cat: 'clean', anim: c.anim, spot, dur: rnd(4, 10), onStart: q => show(q, true), onEnd: q => show(q, false) })) return;
  p.until = sim.t + .5; // nothing free right now: try again shortly (step.ts waits for it while she is idle)
}

/** Working hours: mostly staying at the desk, sometimes an errand that is part of work. */
function work(p: Person): boolean {
  const r = random();
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
/**
 * Breaks: everybody plays. Joining a game or a group that is already going is likely; when the games are full, people take whatever is
 * free (the bar table, coffee, a snack, a chat) instead of going back to work.
 */
function play(p: Person): boolean {
  if (interactables.of('darts').some(x => x.occupant) && random() < .3 && dartsBreak(p)) return true;
  if (interactables.of('golf').some(x => x.occupant) && random() < .3 && golfBreak(p)) return true;
  { const gamers = people.filter(q => q.task?.kind === 'game').length; if (gamers > 0 && gamers < 4 && random() < .35 && gameBreak(p)) return true; }
  const games = shuffle([gameBreak, golfBreak, dartsBreak, musicBreak, sofaBreak, tvBreak, tvBreak]), rest = shuffle([barTrip, coffee, snack, chat]);
  return [...games, ...rest].some(f => f(p));
}
