import { setBlocker, setChairTop, type ObstacleRect } from "../nav/grid";
import { S, toPx } from "../plan";
import { CATALOGUE, shapeOf } from "./catalogue";
import type { WorldObject } from "./objects";

// Where an item that blocks walking (a table, a sofa, a cabinet) stands on the walk grid: its footprint, a rectangle in plan pixels, turned
// with it. At its starting place it is exactly the rectangle the furniture code used to block as a fixed obstacle, so an office where
// nothing has moved walks exactly as before. See docs/ITEMS-PHYSICS-PLAN.md, step 4.

/** The rectangle this item blocks now, in plan pixels, or null (it does not block, or somebody is carrying it). */
export function footprintOf(o: WorldObject): ObstacleRect | null {
  if (o.removed || o.carriedBy !== null) return null;
  const foot = shapeOf(o).foot;
  if (!foot) return null;
  const [hw, hd] = foot,
    [cx, cy] = toPx(o),
    c = Math.abs(Math.cos(o.rot)),
    s = Math.abs(Math.sin(o.rot));
  // (a thing lying on its side still covers about the floor it stood on: close enough for walking round it)
  const ex = hw * c + hd * s,
    ey = hw * s + hd * c;
  return [cx - ex, cy - ey, cx + ex, cy + ey];
}

/** Put this item's footprint on the walk grid where it is now (or take it off). An upright item with a top (a chair seat,
 *  a table, a sofa) is a surface a jumper can land on, so its height is stamped on the walk grid with the footprint. */
export const refreshFootprint = (o: WorldObject): void => {
  const shape = shapeOf(o);
  const top = o.q === null ? shape.top?.y : undefined;
  const foot = footprintOf(o);
  setBlocker(o.index, foot, top === undefined ? undefined : o.y + top);
  if (
    !foot &&
    !o.removed &&
    o.carriedBy === null &&
    o.q === null &&
    shape.top &&
    CATALOGUE[o.type]?.rests === "floor"
  ) {
    const [cx, cy] = toPx(o);
    const r = Math.max(6, Math.max(shape.top.hw, shape.top.hd) / S + 2);
    setChairTop(o.index, [cx - r, cy - r, cx + r, cy + r], o.y + shape.top.y);
  } else {
    setChairTop(o.index, null);
  }
};
