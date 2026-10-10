import { setBlocker, type ObstacleRect } from '../nav/grid';
import { toPx } from '../plan';
import { shapeOf } from './catalogue';
import type { WorldObject } from './objects';

// Where an item that blocks walking (a table, a sofa, a cabinet) stands on the walk grid: its footprint, a rectangle in plan pixels, turned
// with it. At its starting place it is exactly the rectangle the furniture code used to block as a fixed obstacle, so an office where
// nothing has moved walks exactly as before. See docs/ITEMS-PHYSICS-PLAN.md, step 4.

/** The rectangle this item blocks now, in plan pixels, or null (it does not block, or somebody is carrying it). */
export function footprintOf(o: WorldObject): ObstacleRect | null {
  if (o.carriedBy !== null) return null;
  const foot = shapeOf(o).foot;
  if (!foot) return null;
  const [hw, hd] = foot, [cx, cy] = toPx(o), c = Math.abs(Math.cos(o.rot)), s = Math.abs(Math.sin(o.rot));
  // (a thing lying on its side still covers about the floor it stood on: close enough for walking round it)
  const ex = hw * c + hd * s, ey = hw * s + hd * c;
  return [cx - ex, cy - ey, cx + ex, cy + ey];
}

/** Put this item's footprint on the walk grid where it is now (or take it off). */
export const refreshFootprint = (o: WorldObject): void => setBlocker(o.index, footprintOf(o));
