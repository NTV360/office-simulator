/** People literally bumping into each other: a face-to-face meeting stops both for a scratch-head beat, and a walker about to stride
 *  through somebody in front of it sidesteps round them instead of phasing through. Lives in the sim so authority and prediction agree. */

import { OX, OY, S } from '../plan';
import { walkPx } from '../nav/grid';
import { rnd } from '../util';
import { isDriven } from './person';
import { people } from './state';
import type { Person } from './types';

const REACH = .5, FACING = .5, COOLDOWN = 3, STEP_ASIDE = .7; // metres sideways when going around someone

/** p and q walking face-first into each other, within reach. */
function headOn(p: Person, q: Person): boolean {
  const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  const ax = Math.sin(p.faceGoal), az = Math.cos(p.faceGoal), bx = Math.sin(q.faceGoal), bz = Math.cos(q.faceGoal);
  return (ax * dx + az * dz) / d > FACING && -(bx * dx + bz * dz) / d > FACING && ax * bx + az * bz < -FACING;
}

/** q is within reach somewhere in front of p, whatever q is doing (standing, walking away, crossing). */
function aheadOf(p: Person, q: Person): boolean {
  const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  return (Math.sin(p.faceGoal) * dx + Math.cos(p.faceGoal) * dz) / d > FACING;
}

/** Stop for a beat: the scratch animation plays out on the spot. */
function halt(p: Person): void { p.scratch = rnd(1.6, 2.6); }

const open = (x: number, z: number): boolean => walkPx(x / S + OX, z / S + OY);

/** After a bump, swing around q instead of resuming straight into them: step aside now, pass them on that side, then rejoin the rest of the path. */
function detour(p: Person, q: Person): void {
  if (!p.path || p.pi >= p.path.length) return;
  const rx = Math.cos(p.faceGoal), rz = -Math.sin(p.faceGoal); // p's right, in (x, z)
  const dqx = q.pos.x - p.pos.x, dqz = q.pos.z - p.pos.z, dq = Math.hypot(dqx, dqz) || 1;
  const side0 = dqx * rx + dqz * rz > 0 ? -1 : 1;
  for (const side of [side0, -side0]) {
    const w1 = { x: p.pos.x + rx * side * STEP_ASIDE, z: p.pos.z + rz * side * STEP_ASIDE };
    const w2 = { x: q.pos.x + (dqx / dq) * .55 + rx * side * STEP_ASIDE, z: q.pos.z + (dqz / dq) * .55 + rz * side * STEP_ASIDE };
    if (open(w1.x, w1.z) && open(w2.x, w2.z) && open((w1.x + w2.x) / 2, (w1.z + w2.z) / 2)) { p.path.splice(p.pi, 0, w1, w2); return; }
  }
}

/** Per-tick: cool the scratch timers down, then stop walkers about to share a cell with a body — and send them round it. */
export function updateBumps(dt: number): void {
  for (const p of people) {
    if ((p.scratch ?? 0) > 0) {
      p.scratch = Math.max(0, (p.scratch ?? 0) - dt);
      if (p.scratch === 0) p.bumpCd = COOLDOWN;
    } else if ((p.bumpCd ?? 0) > 0) p.bumpCd = (p.bumpCd ?? 0) - dt;
  }
  for (const p of people) {
    if (p.state !== 'walking' || (p.scratch ?? 0) > 0 || (p.bumpCd ?? 0) > 0) continue;
    for (const q of people) {
      if (q === p || q.state === 'away') continue;
      if (isDriven(q)) {
        // a human-steered person never gets halted or animated: the walker steps round them like a solid
        if (aheadOf(p, q)) { halt(p); detour(p, q); break; }
        continue;
      }
      if ((q.scratch ?? 0) <= 0 && (q.bumpCd ?? 0) <= 0 && q.state === 'walking' && headOn(p, q)) {
        halt(p); halt(q); detour(p, q); detour(q, p);
        break;
      }
      if (aheadOf(p, q)) { halt(p); detour(p, q); break; }
    }
  }
}
