import { Vec3 } from './vec3';

/* ================= Plan coordinates (pixels of Draft 06) → metres ================= */
// Draft 07 plan coordinates are PDF points; 1 pt ≈ 4.1 cm on the floor (office enlarged for roomier spaces)
const S = 0.041, OX = 397.85, OY = 577.05;
const wx = (px: number): number => (px - OX) * S, wz = (py: number): number => (py - OY) * S;
/** A plan position (px, py) as a point on the floor, in metres. */
const W = (px: number, py: number): Vec3 => new Vec3(wx(px), 0, wz(py));
/** The reverse of W: a floor position back to plan units. */
const toPx = (v: { x: number; z: number }): [number, number] => [v.x / S + OX, v.z / S + OY];

/** The outline of the floor, as plan points. */
const OUTER: [number, number][] = [[113.5,70.8],[682.2,70.8],[682.2,1113],[437.3,1113],[437.3,1083.3],[271.2,1083.3],[271.2,1038.9],[351.8,1038.9],[351.8,389],[113.5,389]];
/** Wall segments [x1, y1, x2, y2] in plan units. Every wall is horizontal or vertical; a gap is a doorway. */
const WALLS: [number, number, number, number][] = [
  [113.5,70.8,682.2,70.8],[113.5,70.8,113.5,389],[113.5,389,189.6,389],[257.4,389,351.8,389],
  [682.2,70.8,682.2,1113],[271.2,1083.3,437.3,1083.3],[437.3,1083.3,437.3,1113],[437.3,1113,682.2,1113],[271.2,1038.9,271.2,1083.3],[271.2,1038.9,351.8,1038.9],
  [351.8,389,351.8,1038.9],[351.8,1062,351.8,1083.3],
  [113.5,193.6,236,193.6],[260,193.6,274,193.6],[299,193.6,400,193.6],
  [262.9,70.8,262.9,193.6],[400,70.8,400,193.6],
  [218.5,193.6,218.5,199.5],[218.5,224,218.5,305],[113.5,305,218.5,305]
];
const WALL_T = 4.8, FULL_H = 2.7, LOW_H = 1.1;

export { FULL_H, LOW_H, OUTER, OX, OY, S, W, WALLS, WALL_T, toPx, wx, wz };
