import { OX, OY, S } from "../config/plan.js";
import { supportAt, walkPxAt } from "../nav/grid.js";
import { people } from "../sim/state.js";
import { player } from "./player.js";

const GRAV = 22,
  JUMP_V = 7; // snappy Roblox-style arc: about 1.1 m up

// Move a person by (dx, dz) metres, sliding along walls and furniture and nudging out of other people.
// While the feet are high enough to clear what blocks a cell (jumping), it is passable.
// Returns the distance actually moved.
function stepPlayer(p, dx, dz) {
  const ox = p.pos.x,
    oz = p.pos.z,
    free0 = !walkPxAt(ox / S + OX, oz / S + OY, player.feet);
  const ok = (x, z) => free0 || walkPxAt(x / S + OX, z / S + OY, player.feet);
  if (ok(ox + dx, oz + dz)) {
    p.pos.x += dx;
    p.pos.z += dz;
  } else if (ok(ox + dx, oz)) p.pos.x += dx;
  else if (ok(ox, oz + dz)) p.pos.z += dz;
  for (const q of people) {
    if (q === p || q.state === "away") continue;
    const ddx = p.pos.x - q.pos.x,
      ddz = p.pos.z - q.pos.z,
      d = Math.hypot(ddx, ddz);
    if (d > 0 && d < 0.42) {
      const nx = p.pos.x + (ddx / d) * (0.42 - d),
        nz = p.pos.z + (ddz / d) * (0.42 - d);
      if (ok(nx, nz)) {
        p.pos.x = nx;
        p.pos.z = nz;
      }
    }
  }
  return Math.hypot(p.pos.x - ox, p.pos.z - oz);
}

// Gravity and support: jump with `want`, land on the floor or on whatever stands under the player
// (a desk top, a counter, a chair seat). Sitting keeps both feet on the floor.
function tickJump(p, dt, want) {
  if (player.sitting) {
    player.feet = 0;
    player.vy = 0;
    player.air = false;
    p.pos.y = 0;
    return;
  }
  const sup = supportAt(p.pos.x / S + OX, p.pos.z / S + OY);
  if (!player.air && player.feet > sup) player.air = true; // walked off a ledge
  if (want && !player.air) {
    player.vy = JUMP_V;
    player.air = true;
  }
  if (player.air) {
    player.vy -= GRAV * dt;
    player.feet += player.vy * dt;
    if (player.feet <= sup) {
      player.feet = sup;
      player.vy = 0;
      player.air = false;
    }
  } else player.feet = sup;
  p.pos.y = player.feet;
}

export { stepPlayer, tickJump };
