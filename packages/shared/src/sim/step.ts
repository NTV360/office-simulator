import { OX, OY, S } from '../plan';
import { walkPx } from '../nav/grid';
import { angDiff } from '../util';
import { arriveNow, newDay } from './day';
import type { Spot } from './interactables';
import { live, tickLive } from './live';
import { tickMeetings, tryMeeting } from './meetings';
import { isDriven, isHelper } from './person';
import { DAY_END, breakIndex } from './schedule';
import { CLOCK, people, sim } from './state';
import { arrive, chooseNext, returnFromToilet } from './tasks';
import type { Person } from './types';

/* ================= Simulation step ================= */
export function stepPerson(p: Person, dt: number): void {
  if (isDriven(p)) return;
  if (p.state === 'away') {
    if (p.toiletUntil) { if (sim.t >= p.toiletUntil) returnFromToilet(p); return; }
    if (!p.arrivedAt && sim.t >= p.arriveAt && sim.t < p.leaveAt) arriveNow(p);
    return;
  }
  p.animT += dt * Math.min(sim.speed, 2.5);
  if (p.state === 'walking' && p.path) {
    let step = p.speed * dt * sim.speed * (p.task?.run ? 2.4 : 1), moved = 0; // running for the bucket
    while (step > 1e-6 && p.pi < p.path.length) {
      const tg = p.path[p.pi], dx = tg.x - p.pos.x, dz = tg.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > .02) p.faceGoal = Math.atan2(dx, dz);
      if (d <= step) { p.pos.x = tg.x; p.pos.z = tg.z; step -= d; moved += d; p.pi++; }
      else { p.pos.x += dx / d * step; p.pos.z += dz / d * step; moved += step; step = 0; }
    }
    p.walkPhase += moved * 4.6;
    // gentle avoidance while in open floor
    if (p.pi < p.path.length - 1 && moved > 0) {
      for (const q of people) {
        if (q === p || q.state !== 'walking') continue;
        const dx = p.pos.x - q.pos.x, dz = p.pos.z - q.pos.z, d = Math.hypot(dx, dz);
        if (d > 0 && d < .5) {
          const push = Math.min((.5 - d) * .35, moved * .5), nx = p.pos.x + dx / d * push, nz = p.pos.z + dz / d * push;
          if (walkPx(nx / S + OX, nz / S + OY)) { p.pos.x = nx; p.pos.z = nz; }
        }
      }
    }
    if (p.pi >= p.path.length) arrive(p);
  } else if (p.state === 'doing') {
    // a break starting stops desk work right away (once per break), so people get up and play
    if (p.task?.kind === 'work') { const b = breakIndex(p, sim.t), key = sim.day * 10 + b; if (b >= 0 && p.breakKey !== key) { p.breakKey = key; p.until = sim.t; } }
    if (sim.t >= p.until) {
      const wasExit = p.task?.kind === 'exit';
      if (!wasExit) chooseNext(p);
    }
  } else if (p.state === 'idle') { if (!isHelper(p) || sim.t >= p.until) chooseNext(p); } // (the helper waits when nothing is free: see cleanNext)
  const k = 1 - Math.exp(-dt * 10 * Math.min(sim.speed, 3));
  p.face += angDiff(p.face, p.faceGoal) * k;
}

/**
 * What a desk monitor shows: 'off' (nobody's desk, or they are not in), 'lock' (in but not working), or
 * 'kind:variant' (working; e.g. 'code:3'). The client turns that into a material.
 */
export function screenState(s: Spot): string {
  const p = s.owner as Person | null | undefined;
  if (!p || p.state === 'away') return 'off';
  return (p.state === 'doing' && p.task?.spot === s && p.task.kind === 'work') ? p.screenKind + ':' + p.screenVariant : 'lock';
}

/** Advance the whole simulation by dt real seconds: the clock, meetings, the day roll-over, and every person. */
export function stepSim(dt: number): void {
  if (live.mode === 'live') { if (tickLive()) newDay(); } // the real office clock
  else sim.t += dt * sim.speed * CLOCK;
  if (Math.floor(sim.t) !== sim.lastMinute) { sim.lastMinute = Math.floor(sim.t); tryMeeting(); }
  tickMeetings();
  if (sim.t >= DAY_END) newDay();
  for (const p of people) stepPerson(p, dt);
}
