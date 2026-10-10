import { FRONT_Y, OUTER } from '../plan';

/* ================= Navigation grid ================= */
/** An obstacle rectangle in plan pixels: [x1, y1, x2, y2] with x1 <= x2 and y1 <= y2. */
export type ObstacleRect = readonly [number, number, number, number];

export const GX0 = 109, GY0 = 66, CS = 4.5;
export const GC = Math.ceil((687 - GX0) / CS), GR = Math.ceil((1088 - GY0) / CS);
export const NAV = new Uint8Array(GC * GR);
const MARGIN = 6;

function inPoly(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const cellOf = (x: number, y: number): [number, number] => [Math.floor((x - GX0) / CS), Math.floor((y - GY0) / CS)];
export const walkPx = (x: number, y: number): boolean => { const [c, r] = cellOf(x, y); return c >= 0 && r >= 0 && c < GC && r < GR && NAV[r * GC + c] === 1; };
export function nearestWalk(c: number, r: number): [number, number] | null {
  if (NAV[r * GC + c]) return [c, r];
  for (let rad = 1; rad < 14; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
    const cc = c + dc, rr = r + dr;
    if (cc >= 0 && rr >= 0 && cc < GC && rr < GR && NAV[rr * GC + cc]) return [cc, rr];
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
  for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) {
    const x = GX0 + (c + .5) * CS, y = GY0 + (r + .5) * CS;
    let ok = inPoly(x, y, OUTER) || (x > 182 && x < 265 && y > FRONT_Y - 4 && y < FRONT_Y + 43); // + the walkway outside the doors
    if (ok) for (const o of obstacles) if (x > o[0] - MARGIN && x < o[2] + MARGIN && y > o[1] - MARGIN && y < o[3] + MARGIN) { ok = false; break; }
    BASE[r * GC + c] = ok ? 1 : 0;
  }
  NAV.set(BASE);
  BLOCKS.fill(0);
  blockers.clear();
  version++;
}

/**
 * Something that blocks walking (an item: `key` is its index) stands on this rectangle now, in plan pixels, or on nothing (null: it was
 * picked up). The cells are the ones a fixed obstacle of that rectangle would block, margin and all.
 */
export function setBlocker(key: number, rect: ObstacleRect | null): void {
  const old = blockers.get(key);
  const cells: number[] = [];
  if (rect) {
    const c0 = Math.max(0, Math.floor((rect[0] - MARGIN - GX0) / CS - .5)), c1 = Math.min(GC - 1, Math.ceil((rect[2] + MARGIN - GX0) / CS - .5));
    const r0 = Math.max(0, Math.floor((rect[1] - MARGIN - GY0) / CS - .5)), r1 = Math.min(GR - 1, Math.ceil((rect[3] + MARGIN - GY0) / CS - .5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = GX0 + (c + .5) * CS, y = GY0 + (r + .5) * CS;
      if (x > rect[0] - MARGIN && x < rect[2] + MARGIN && y > rect[1] - MARGIN && y < rect[3] + MARGIN) cells.push(r * GC + c);
    }
  }
  if (old && old.length === cells.length && old.every((v, i) => v === cells[i])) return; // (moved within the same cells: nothing changes)
  if (old) for (const i of old) { BLOCKS[i]--; NAV[i] = BASE[i] && !BLOCKS[i] ? 1 : 0; }
  for (const i of cells) { BLOCKS[i]++; NAV[i] = 0; }
  if (cells.length) blockers.set(key, cells); else blockers.delete(key);
  version++;
}
