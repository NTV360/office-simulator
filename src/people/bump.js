import { player } from '../player/player.js';
import { rnd } from '../core/util.js';
import { people } from '../sim/state.js';

const REACH = .5, FACING = .5, COOLDOWN = 3;

function headOn(p, q) {
  const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  const ax = Math.sin(p.faceGoal), az = Math.cos(p.faceGoal), bx = Math.sin(q.faceGoal), bz = Math.cos(q.faceGoal);
  return (ax * dx + az * dz) / d > FACING && -(bx * dx + bz * dz) / d > FACING && ax * bx + az * bz < -FACING;
}
function halt(p) { p.scratch = rnd(1.6, 2.6); }

function updateBumps(dt) {
  for (const p of people) {
    if (p.scratch > 0) { p.scratch -= dt; if (p.scratch <= 0) { p.scratch = 0; p.bumpCd = COOLDOWN; } }
    else if (p.bumpCd > 0) p.bumpCd -= dt;
  }
  const me = player.person, meMoving = !!me && !player.sitting && player.moving;
  for (const p of people) {
    if (p.state !== 'walking' || p.scratch > 0 || p.bumpCd > 0) continue;
    for (const q of people) if (q !== p && q.state === 'walking' && q.scratch <= 0 && q.bumpCd <= 0 && headOn(p, q)) { halt(p); halt(q); break; }
    if (p.scratch <= 0 && meMoving && headOn(p, me)) halt(p);
  }
}

export { updateBumps };
