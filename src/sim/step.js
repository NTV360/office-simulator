import { OX, OY, S } from '../config/plan.js';
import { angDiff } from '../core/util.js';
import { walkPx } from '../nav/grid.js';
import { SCREENS } from '../render/screens.js';
import { arriveNow } from './day.js';
import { breakIndex } from './schedule.js';
import { people, sim } from './state.js';
import { arrive, chooseNext, returnFromToilet } from './tasks.js';
import { interactables } from '../world/interactables.js';

/* ================= Simulation step ================= */
function stepPerson(p, dt, sdt) {
  if (p.state === 'player') return;
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
  } else if (p.state === 'idle') { chooseNext(p); }
  const k = 1 - Math.exp(-dt * 10 * Math.min(sim.speed, 3));
  p.face += angDiff(p.face, p.faceGoal) * k;
}

function updateScreens() {
  for (const s of interactables.of('desk')) {
    const p = s.owner;
    let m = SCREENS.off;
    if (p && p.state !== 'away') m = (p.state === 'doing' && p.task?.spot === s && (p.task.kind === 'work')) ? p.screenMat : SCREENS.lock;
    if (s.screen.material !== m) s.screen.material = m;
  }
}

export { stepPerson, updateScreens };
