import { OX, OY, S } from '@office/shared';
import { SOLIDS, wall } from '../world/helpers.js';

// Camera vs walls. The third-person camera sits on an "arm" from the player's head to where it
// wants to be; this says how far along that arm it can go before a wall is in the way. A wall
// only blocks while the arm is lower than the wall's current height, so with low walls the
// camera sees over them and with full walls it is pulled in.
let boxes = null, builtFor = -1, builtMargin = 0;
function prepare(margin) {
  boxes = SOLIDS.map(([x1, y1, x2, y2, h]) => [(x1 - OX) * S - margin, (y1 - OY) * S - margin, (x2 - OX) * S + margin, (y2 - OY) * S + margin, h]);
  builtFor = SOLIDS.length; builtMargin = margin;
}

// Returns 0..1: the fraction of the arm a→b that is clear. Positions are in metres.
function armFraction(ax, ay, az, bx, by, bz, margin = .14) {
  if (!boxes || builtFor !== SOLIDS.length || builtMargin !== margin) prepare(margin);
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let best = 1;
  for (const [x1, z1, x2, z2, fullH] of boxes) {
    const top = Math.min(fullH, wall.h) + .05;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (ax < x1 || ax > x2) continue; } else { let ta = (x1 - ax) / dx, tb = (x2 - ax) / dx; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
    if (Math.abs(dz) < 1e-9) { if (az < z1 || az > z2) continue; } else { let ta = (z1 - az) / dz, tb = (z2 - az) / dz; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
    if (t0 > t1 || t0 <= 0) continue; // misses, or starts inside (player pressed against it)
    if (Math.min(ay + dy * t0, ay + dy * t1) >= top) continue; // passes over the top
    best = Math.min(best, t0);
  }
  return Math.max(0, best - .03);
}

export { armFraction };
