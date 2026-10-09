import { Vec3 } from './vec3';

/* ================= Plan coordinates (pixels of Draft 06) → metres ================= */
// Draft 07 plan coordinates are PDF points; 1 pt ≈ 4.1 cm on the floor (office enlarged for roomier spaces)
const S = 0.041, OX = 397.85, OY = 577.05;
const wx = (px: number): number => (px - OX) * S, wz = (py: number): number => (py - OY) * S;
/** A plan position (px, py) as a point on the floor, in metres. */
const W = (px: number, py: number): Vec3 => new Vec3(wx(px), 0, wz(py));
/** The reverse of W: a floor position back to plan units. */
const toPx = (v: { x: number; z: number }): [number, number] => [v.x / S + OX, v.z / S + OY];

/** The front wall with the entrance doors (it was at 389; moved out to give the lounge room). The doors, the walkway outside and where people arrive and leave are placed relative to it. */
const FRONT_Y = 425;
/** The outline of the floor, as plan points. */
const OUTER: [number, number][] = [[113.5,70.8],[682.2,70.8],[682.2,1113],[437.3,1113],[437.3,1083.3],[271.2,1083.3],[271.2,1038.9],[351.8,1038.9],[351.8,FRONT_Y],[113.5,FRONT_Y]];
/** Wall segments [x1, y1, x2, y2] in plan units. Every wall is horizontal or vertical; a gap is a doorway. */
const WALLS: [number, number, number, number][] = [
  [113.5,70.8,682.2,70.8],[113.5,70.8,113.5,FRONT_Y],[113.5,FRONT_Y,189.6,FRONT_Y],[257.4,FRONT_Y,351.8,FRONT_Y],
  [682.2,70.8,682.2,1113],[271.2,1083.3,437.3,1083.3],[437.3,1083.3,437.3,1113],[437.3,1113,682.2,1113],[271.2,1038.9,271.2,1083.3],[271.2,1038.9,351.8,1038.9],
  [351.8,FRONT_Y,351.8,1038.9],[351.8,1062,351.8,1083.3]
];
/** Glass partitions around the rooms: Conference 1, the HR office (the old Conference 2) and Conference 3. A gap is a doorway, as in WALLS. */
const GLASS_WALLS: [number, number, number, number][] = [
  [113.5,193.6,236,193.6],[260,193.6,274,193.6],[299,193.6,400,193.6],
  [262.9,70.8,262.9,193.6],[400,70.8,400,193.6],
  [218.5,193.6,218.5,199.5],[218.5,224,218.5,329],[113.5,329,218.5,329] // Conference 3 reaches y 329, toward the entrance
];
const WALL_T = 4.8, FULL_H = 2.7, LOW_H = 1.1;

export { FRONT_Y, FULL_H, GLASS_WALLS, LOW_H, OUTER, OX, OY, S, W, WALLS, WALL_T, toPx, wx, wz };
