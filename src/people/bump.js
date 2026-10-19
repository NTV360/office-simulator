import { OX, OY, S } from "../config/plan.js";
import { rnd } from "../core/util.js";
import { walkPx } from "../nav/grid.js";
import { player } from "../player/player.js";
import { people } from "../sim/state.js";

const REACH = 0.5,
  FACING = 0.5,
  COOLDOWN = 3,
  STEP_ASIDE = 0.7; // metres sideways when going around someone

// both facing each other: a true front-to-front meeting
function headOn(p, q) {
  const dx = q.pos.x - p.pos.x,
    dz = q.pos.z - p.pos.z,
    d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  const ax = Math.sin(p.faceGoal),
    az = Math.cos(p.faceGoal),
    bx = Math.sin(q.faceGoal),
    bz = Math.cos(q.faceGoal);
  return (
    (ax * dx + az * dz) / d > FACING &&
    -(bx * dx + bz * dz) / d > FACING &&
    ax * bx + az * bz < -FACING
  );
}
// q is within reach somewhere in front of p, whatever q is doing
function aheadOf(p, q) {
  const dx = q.pos.x - p.pos.x,
    dz = q.pos.z - p.pos.z,
    d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  const ax = Math.sin(p.faceGoal),
    az = Math.cos(p.faceGoal);
  return (ax * dx + az * dz) / d > FACING;
}
function halt(p) {
  p.scratch = rnd(1.6, 2.6);
}

const open = (x, z) => walkPx(x / S + OX, z / S + OY);
// after a bump, swing around q instead of resuming straight into them:
// step aside now, pass them on that side, then rejoin the rest of the path
function detour(p, q) {
  if (!p.path || p.pi >= p.path.length) return;
  const rx = Math.cos(p.faceGoal),
    rz = -Math.sin(p.faceGoal); // p's right, in (x, z)
  const dqx = q.pos.x - p.pos.x,
    dqz = q.pos.z - p.pos.z,
    dq = Math.hypot(dqx, dqz) || 1;
  for (const side of [
    dqx * rx + dqz * rz > 0 ? -1 : 1,
    dqx * rx + dqz * rz > 0 ? 1 : -1,
  ]) {
    const w1 = {
      x: p.pos.x + rx * side * STEP_ASIDE,
      z: p.pos.z + rz * side * STEP_ASIDE,
    };
    const w2 = {
      x: q.pos.x + (dqx / dq) * 0.55 + rx * side * STEP_ASIDE,
      z: q.pos.z + (dqz / dq) * 0.55 + rz * side * STEP_ASIDE,
    };
    if (
      open(w1.x, w1.z) &&
      open(w2.x, w2.z) &&
      open((w1.x + w2.x) / 2, (w1.z + w2.z) / 2)
    ) {
      p.path.splice(p.pi, 0, w1, w2);
      return;
    }
  }
}

function updateBumps(dt) {
  for (const p of people) {
    if (p.scratch > 0) {
      p.scratch -= dt;
      if (p.scratch <= 0) {
        p.scratch = 0;
        p.bumpCd = COOLDOWN;
      }
    } else if (p.bumpCd > 0) p.bumpCd -= dt;
  }
  const me = player.person;
  for (const p of people) {
    if (p.state !== "walking" || p.scratch > 0 || p.bumpCd > 0) continue;
    for (const q of people) {
      if (q === p || q.state === "away") continue;
      if (headOn(p, q)) {
        halt(p);
        detour(p, q);
        if (q !== me && q.scratch <= 0 && q.bumpCd <= 0) {
          halt(q);
          detour(q, p);
        }
        break;
      }
      if (aheadOf(p, q)) {
        halt(p);
        detour(p, q);
        break;
      }
    }
    if (
      p.scratch <= 0 &&
      me &&
      !player.sitting &&
      (headOn(p, me) || aheadOf(p, me))
    ) {
      halt(p);
      detour(p, me); // the player never animates
    }
  }
}

export { updateBumps };
