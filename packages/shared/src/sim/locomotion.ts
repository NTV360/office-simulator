import { walkPxAt } from "../nav/grid";
import { OX, OY, S } from "../plan";

/** What stepPlayer needs to know about a person. */
export interface Walker {
  pos: { x: number; y?: number; z: number };
  state?: string;
}

/**
 * Move a person by (dx, dz) metres, sliding along walls and furniture and nudging out of other people.
 * `others` is everyone who can be bumped into (the caller's own entry is skipped). Returns the distance actually moved.
 * `pos.y` is the feet height: an airborne person may cross a blocked cell whose standable top is below the feet.
 */
export function stepPlayer(
  p: Walker,
  dx: number,
  dz: number,
  others: readonly Walker[],
): number {
  const ox = p.pos.x,
    oz = p.pos.z,
    feet = p.pos.y || 0,
    free0 = !walkPxAt(ox / S + OX, oz / S + OY, feet);
  const ok = (x: number, z: number) =>
    free0 || walkPxAt(x / S + OX, z / S + OY, feet);
  if (ok(ox + dx, oz + dz)) {
    p.pos.x += dx;
    p.pos.z += dz;
  } else if (ok(ox + dx, oz)) p.pos.x += dx;
  else if (ok(ox, oz + dz)) p.pos.z += dz;
  for (const q of others) {
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
