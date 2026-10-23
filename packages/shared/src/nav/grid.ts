import { FRONT_Y, OUTER } from "../plan";

/* ================= Navigation grid ================= */
/** An obstacle rectangle in plan pixels: [x1, y1, x2, y2] with x1 <= x2 and y1 <= y2. */
export type ObstacleRect = readonly [number, number, number, number];

export const GX0 = 109,
  GY0 = 66,
  CS = 4.5;
export const GC = Math.ceil((687 - GX0) / CS),
  GR = Math.ceil((1088 - GY0) / CS);
export const NAV = new Uint8Array(GC * GR);
const MARGIN = 6;

function inPoly(
  x: number,
  y: number,
  poly: readonly (readonly [number, number])[],
): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      c = !c;
  }
  return c;
}
export const cellOf = (x: number, y: number): [number, number] => [
  Math.floor((x - GX0) / CS),
  Math.floor((y - GY0) / CS),
];
export const walkPx = (x: number, y: number): boolean => {
  const [c, r] = cellOf(x, y);
  return c >= 0 && r >= 0 && c < GC && r < GR && NAV[r * GC + c] === 1;
};

/** Standable height per cell (metres): a desk top or chair seat a jumping person can land on and walk across. 0 = none.
 *  Walls, glass and other full-height obstacles never get one, so they stay unjumpable. */
const TOP = new Float32Array(GC * GR);
/** Standable tops of movable items (a table, a sofa): keyed by the item's blocker key, so moving the item moves its top. */
const ITOP = new Float32Array(GC * GR);
/** Standable tops of floor chairs and stools (which do not block NAV, but support a jumping person). */
const CTOP = new Float32Array(GC * GR);
/** 1 where a cell is outside the floor outline or within MARGIN of a solid (untopped) fixed obstacle such as a wall. */
const SOLID = new Uint8Array(GC * GR);
/** Count of unjumpable movable items (plants, floor TVs, whiteboards) blocking each cell. */
const SOLID_BLOCKS = new Uint16Array(GC * GR);
const topCells = new Map<number, { cells: number[]; h: number }>();
const chairCells = new Map<number, { cells: number[]; h: number }>();
let lastObstacles: readonly ObstacleRect[] = [];
const topRects: Array<readonly [number, number, number, number, number]> = [];

const isFloorInside = (x: number, y: number): boolean =>
  inPoly(x, y, OUTER) ||
  (x > 182 && x < 265 && y > FRONT_Y - 4 && y < FRONT_Y + 43);

function isToppedObstacle(o: ObstacleRect): boolean {
  for (const t of topRects) {
    if (
      Math.abs(o[0] - t[0]) < 1.5 &&
      Math.abs(o[1] - t[1]) < 1.5 &&
      Math.abs(o[2] - t[2]) < 1.5 &&
      Math.abs(o[3] - t[3]) < 1.5
    )
      return true;
  }
  return false;
}

/** Feet-aware walk check: any blocked cell is passable once the feet clear its standable top — a desk, a counter or a
 *  chair seat. Cells with no top (walls, glass, plants, things resting on furniture) stay solid whatever the height. */
export function walkPxAt(x: number, y: number, feet = 0): boolean {
  const [c, r] = cellOf(x, y);
  if (c < 0 || r < 0 || c >= GC || r >= GR) return false;
  const i = r * GC + c;
  if (NAV[i] === 1) return true;
  if (SOLID[i] || SOLID_BLOCKS[i]) return false;
  const t = Math.max(TOP[i], ITOP[i]);
  return t > 0 && feet >= t - 1e-6;
}

/** The surface under a person on this cell: the standable top of a blocked cell (or a chair seat when jumping onto it), else the floor. */
export function supportAt(x: number, y: number, feet = 0): number {
  const [c, r] = cellOf(x, y);
  if (c < 0 || r < 0 || c >= GC || r >= GR) return 0;
  const i = r * GC + c;
  const base = NAV[i] === 1 ? 0 : Math.max(TOP[i], ITOP[i]);
  const ct = CTOP[i];
  return ct > base && feet >= ct - 0.15 ? ct : base;
}

/** Register a standable top over a rectangle (plan px): every cell its obstacle blocks (including MARGIN, clear of walls) gets the highest height seen. */
export function setTopRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  h: number,
): void {
  topRects.push([x1, y1, x2, y2, h]);
  const c0 = Math.max(0, Math.floor((x1 - MARGIN - GX0) / CS - 0.5)),
    c1 = Math.min(GC - 1, Math.ceil((x2 + MARGIN - GX0) / CS - 0.5));
  const r0 = Math.max(0, Math.floor((y1 - MARGIN - GY0) / CS - 0.5)),
    r1 = Math.min(GR - 1, Math.ceil((y2 + MARGIN - GY0) / CS - 0.5));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const x = GX0 + (c + 0.5) * CS,
        y = GY0 + (r + 0.5) * CS,
        i = r * GC + c;
      if (
        x > x1 - MARGIN &&
        x < x2 + MARGIN &&
        y > y1 - MARGIN &&
        y < y2 + MARGIN &&
        BASE[i] === 0 &&
        isFloorInside(x, y)
      ) {
        let hitSolid = false;
        for (const o of lastObstacles) {
          if (
            x > o[0] - MARGIN &&
            x < o[2] + MARGIN &&
            y > o[1] - MARGIN &&
            y < o[3] + MARGIN &&
            !isToppedObstacle(o)
          ) {
            hitSolid = true;
            break;
          }
        }
        if (!hitSolid) {
          SOLID[i] = 0;
          if (h > TOP[i]) TOP[i] = h;
        }
      }
    }
}
export function nearestWalk(c: number, r: number): [number, number] | null {
  if (NAV[r * GC + c]) return [c, r];
  for (let rad = 1; rad < 14; rad++)
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc,
          rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < GC && rr < GR && NAV[rr * GC + cc])
          return [cc, rr];
      }
  return null;
}

// The grid is the building and its fixed furniture (BASE), less whatever items stand on it now (BLOCKS counts them per cell): a sofa
// that is moved lifts its old cells and blocks its new ones. NAV is the result, kept up to date, so walking code reads one array.
const BASE = new Uint8Array(GC * GR);
const BLOCKS = new Uint16Array(GC * GR);
const blockers = new Map<number, number[]>();
let version = 0;

/** Goes up every time the walkable cells change (an item that blocks walking moved): a route planned before may now be blocked. */
export const navVersion = (): number => version;

/** Fill the walkable-cell grid from the floor outline and the fixed furniture the world built. Items that block are added with `setBlocker`. */
export function initGrid(obstacles: readonly ObstacleRect[]): void {
  lastObstacles = obstacles;
  topRects.length = 0;
  for (let r = 0; r < GR; r++)
    for (let c = 0; c < GC; c++) {
      const x = GX0 + (c + 0.5) * CS,
        y = GY0 + (r + 0.5) * CS;
      let ok = isFloorInside(x, y);
      if (ok)
        for (const o of obstacles)
          if (
            x > o[0] - MARGIN &&
            x < o[2] + MARGIN &&
            y > o[1] - MARGIN &&
            y < o[3] + MARGIN
          ) {
            ok = false;
            break;
          }
      const i = r * GC + c;
      BASE[i] = ok ? 1 : 0;
      SOLID[i] = ok ? 0 : 1;
    }
  NAV.set(BASE);
  BLOCKS.fill(0);
  SOLID_BLOCKS.fill(0);
  blockers.clear();
  TOP.fill(0); // standable tops come in again after the grid, through setTopRect / refreshFootprint
  ITOP.fill(0);
  CTOP.fill(0);
  topCells.clear();
  chairCells.clear();
  version++;
}

function recomputeItop(cells: readonly number[]): void {
  for (const i of cells) {
    let best = 0;
    for (const entry of topCells.values()) {
      if (entry.h > best && entry.cells.includes(i)) best = entry.h;
    }
    ITOP[i] = best;
  }
}

/**
 * Something that blocks walking (an item: `key` is its index) stands on this rectangle now, in plan pixels, or on nothing (null: it was
 * picked up). The cells are the ones a fixed obstacle of that rectangle would block, margin and all.
 */
export function setBlocker(
  key: number,
  rect: ObstacleRect | null,
  top?: number,
): void {
  const old = blockers.get(key);
  const cells: number[] = [];
  if (rect) {
    const c0 = Math.max(0, Math.floor((rect[0] - MARGIN - GX0) / CS - 0.5)),
      c1 = Math.min(GC - 1, Math.ceil((rect[2] + MARGIN - GX0) / CS - 0.5));
    const r0 = Math.max(0, Math.floor((rect[1] - MARGIN - GY0) / CS - 0.5)),
      r1 = Math.min(GR - 1, Math.ceil((rect[3] + MARGIN - GY0) / CS - 0.5));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = GX0 + (c + 0.5) * CS,
          y = GY0 + (r + 0.5) * CS;
        if (
          x > rect[0] - MARGIN &&
          x < rect[2] + MARGIN &&
          y > rect[1] - MARGIN &&
          y < rect[3] + MARGIN
        )
          cells.push(r * GC + c);
      }
  }
  const h = top !== undefined && top > 0 ? top : 0;
  const oldTops = topCells.get(key);
  if (
    old &&
    oldTops?.h === h &&
    old.length === cells.length &&
    old.every((v, i) => v === cells[i])
  )
    return; // (moved within the same cells: nothing changes)
  if (old)
    for (const i of old) {
      BLOCKS[i]--;
      NAV[i] = BASE[i] && !BLOCKS[i] ? 1 : 0;
    }
  for (const i of cells) {
    BLOCKS[i]++;
    NAV[i] = 0;
  }
  if (cells.length) blockers.set(key, cells);
  else blockers.delete(key);
  if (oldTops) {
    topCells.delete(key);
    if (oldTops.h > 0) recomputeItop(oldTops.cells);
    else for (const i of oldTops.cells) SOLID_BLOCKS[i]--;
  }
  if (cells.length) {
    topCells.set(key, { cells, h });
    if (h > 0) {
      for (const i of cells) if (h > ITOP[i]) ITOP[i] = h;
    } else {
      for (const i of cells) SOLID_BLOCKS[i]++;
    }
  }
  version++;
}

/** Stamp a chair or stool's standable top onto CTOP without blocking NAV. */
export function setChairTop(
  key: number,
  rect: ObstacleRect | null,
  top?: number,
): void {
  const old = chairCells.get(key);
  if (old) {
    chairCells.delete(key);
    for (const i of old.cells) {
      let best = 0;
      for (const entry of chairCells.values())
        if (entry.h > best && entry.cells.includes(i)) best = entry.h;
      CTOP[i] = best;
    }
  }
  if (!rect || top === undefined || top <= 0) return;
  const cells: number[] = [];
  const c0 = Math.max(0, Math.floor((rect[0] - GX0) / CS - 0.5)),
    c1 = Math.min(GC - 1, Math.ceil((rect[2] - GX0) / CS - 0.5));
  const r0 = Math.max(0, Math.floor((rect[1] - GY0) / CS - 0.5)),
    r1 = Math.min(GR - 1, Math.ceil((rect[3] - GY0) / CS - 0.5));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const x = GX0 + (c + 0.5) * CS,
        y = GY0 + (r + 0.5) * CS;
      if (x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]) {
        const i = r * GC + c;
        if (top > CTOP[i]) CTOP[i] = top;
        cells.push(i);
      }
    }
  if (cells.length) chairCells.set(key, { cells, h: top });
}
