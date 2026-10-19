/** People literally bumping into each other: a face-to-face meeting stops both for a scratch-head beat, and a walker about to stride
 *  through somebody in front of it sidesteps round them instead of phasing through. Lives in the sim so authority and prediction agree. */

import { walkPx } from "../nav/grid";
import { OX, OY, S } from "../plan";
import { Vec3 } from "../vec3";
import { isDriven } from "./person";
import { people } from "./state";
import type { Person } from "./types";

const REACH = 0.38, // how close a real bump is (below the soft push-apart: the push failed)
  COURSE = 0.55, // how far out a collision course is read (early enough to sidestep, not just collide)
  FACING = 0.5,
  COOLDOWN = 3,
  STEP_ASIDE = 0.7; // metres sideways when going around someone

/** p and q walking face-first into each other within `reach` and squarely in each other's way — two people sliding
 *  past shoulder to shoulder in a corridor are close and facing, but never collide, so that is not a bump. */
function onCourse(
  p: Person,
  q: Person,
  reach: number,
  maxSide: number,
): boolean {
  const dx = q.pos.x - p.pos.x,
    dz = q.pos.z - p.pos.z,
    d = Math.hypot(dx, dz);
  if (d > reach || d < 1e-6) return false;
  const ax = Math.sin(p.faceGoal),
    az = Math.cos(p.faceGoal),
    bx = Math.sin(q.faceGoal),
    bz = Math.cos(q.faceGoal);
  const side = Math.abs(dx * az - dz * ax); // q's offset across p's line of travel
  return (
    (ax * dx + az * dz) / d > FACING &&
    -(bx * dx + bz * dz) / d > FACING &&
    ax * bx + az * bz < -FACING &&
    side < maxSide
  );
}

/** p and q at the point of actually colliding: facing each other, nearly touching. */
const headOn = (p: Person, q: Person): boolean => onCourse(p, q, REACH, 0.24);

/** q is within reach somewhere in front of p, whatever q is doing (standing, walking away, crossing). */
function aheadOf(p: Person, q: Person): boolean {
  const dx = q.pos.x - p.pos.x,
    dz = q.pos.z - p.pos.z,
    d = Math.hypot(dx, dz);
  if (d > REACH || d < 1e-6) return false;
  return (Math.sin(p.faceGoal) * dx + Math.cos(p.faceGoal) * dz) / d > FACING;
}

/** Stop for a beat: the scratch animation plays out on the spot. (A fixed length — a random draw here would
 *  eat a number from the seeded stream and reshuffle the whole office's day.) */
function halt(p: Person): void {
  p.scratch = 2.1;
}

const open = (x: number, z: number): boolean => walkPx(x / S + OX, z / S + OY);

/** After a bump, swing around q instead of resuming straight into them: step aside now, pass them on that side, then rejoin the rest of the path. True when a sidestep was added. */
function detour(p: Person, q: Person): boolean {
  if (!p.path || p.pi >= p.path.length) return false;
  // Nearly there: somebody settled at the goal itself is just who you are walking up to — sidestepping now would only feed the path more sidesteps forever
  const goal = p.path[p.path.length - 1];
  if (Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z) < 0.5) return false;
  // A path already swollen with sidesteps gets no more: they grow faster than they are walked, and arriving is what matters
  if (p.path.length - p.pi > 24) return false;
  const rx = Math.cos(p.faceGoal),
    rz = -Math.sin(p.faceGoal); // p's right, in (x, z)
  const dqx = q.pos.x - p.pos.x,
    dqz = q.pos.z - p.pos.z,
    dq = Math.hypot(dqx, dqz) || 1;
  const side0 = dqx * rx + dqz * rz > 0 ? -1 : 1;
  for (const side of [side0, -side0]) {
    const w1 = new Vec3(
      p.pos.x + rx * side * STEP_ASIDE,
      0,
      p.pos.z + rz * side * STEP_ASIDE,
    );
    const w2 = new Vec3(
      q.pos.x + (dqx / dq) * 0.55 + rx * side * STEP_ASIDE,
      0,
      q.pos.z + (dqz / dq) * 0.55 + rz * side * STEP_ASIDE,
    );
    if (
      open(w1.x, w1.z) &&
      open(w2.x, w2.z) &&
      open((w1.x + w2.x) / 2, (w1.z + w2.z) / 2)
    ) {
      p.path.splice(p.pi, 0, w1, w2);
      return true;
    }
  }
  return false;
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
    if (p.state !== "walking" || (p.scratch ?? 0) > 0 || (p.bumpCd ?? 0) > 0)
      continue;
    for (const q of people) {
      if (q === p || q.state === "away") continue;
      if (isDriven(q)) {
        // a human-steered person never gets halted or animated: the walker steps round them like a solid
        if (aheadOf(p, q) && detour(p, q)) {
          p.bumpCd = COOLDOWN; // (cool-off, so the sidestep is not re-added every tick while they pass)
          break;
        }
        continue;
      }
      if (
        (q.scratch ?? 0) <= 0 &&
        (q.bumpCd ?? 0) <= 0 &&
        q.state === "walking" &&
        headOn(p, q)
      ) {
        halt(p);
        halt(q);
        detour(p, q);
        detour(q, p);
        break;
      }
      // somebody settled in the corridor ahead (sitting, working, waiting) is NOT sidestepped: the office's desk
      // rows are walked between seated people all day — the no-overlap clamp already keeps p off them, and a
      // detour round a row of settled colleagues just piles sidesteps on top of sidesteps without ever arriving
    }
  }
}
