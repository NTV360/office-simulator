import { W, toPx } from '../plan';
import type { Vec3 } from '../vec3';
import { CS, GC, GR, GX0, GY0, NAV, cellOf, nearestWalk, walkPx } from './grid';

const NCELLS = GC * GR, gS = new Float32Array(NCELLS), from = new Int32Array(NCELLS), seen = new Uint32Array(NCELLS), shut = new Uint32Array(NCELLS);
let gen = 0;
type Cell = readonly [number, number];

function astar(s: Cell, t: Cell): number[] | null {
  gen++;
  const si = s[1] * GC + s[0], ti = t[1] * GC + t[0];
  const hx = t[0], hy = t[1];
  const H = (i: number) => { const dx = Math.abs(i % GC - hx), dy = Math.abs((i / GC | 0) - hy); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
  const heap: number[] = [], hf: number[] = [];
  const push = (i: number, f: number) => {
    heap.push(i); hf.push(f);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p; }
  };
  const pop = (): number => {
    const top = heap[0], li = heap.pop()!, lf = hf.pop()!;
    if (heap.length) {
      heap[0] = li; hf[0] = lf;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && hf[l] < hf[m]) m = l;
        if (r < heap.length && hf[r] < hf[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]];
        k = m;
      }
    }
    return top;
  };
  seen[si] = gen; gS[si] = 0; from[si] = -1; push(si, H(si));
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  while (heap.length) {
    const cur = pop();
    if (cur === ti) break;
    if (shut[cur] === gen) continue;
    shut[cur] = gen;
    const cx = cur % GC, cy = cur / GC | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GC || ny >= GR) continue;
      const ni = ny * GC + nx;
      if (!NAV[ni]) continue;
      if (dx && dy && (!NAV[cy * GC + nx] || !NAV[ny * GC + cx])) continue;
      const ng = gS[cur] + cost;
      if (seen[ni] !== gen || ng < gS[ni]) { seen[ni] = gen; gS[ni] = ng; from[ni] = cur; push(ni, ng + H(ni)); }
    }
  }
  if (seen[ti] !== gen) return null;
  const out: number[] = [];
  for (let i = ti; i !== -1; i = from[i]) out.push(i);
  return out.reverse();
}

type Px = [number, number];
function los(a: Px, b: Px): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.ceil(Math.hypot(dx, dy) / 1.8);
  for (let i = 1; i < n; i++) if (!walkPx(a[0] + dx * i / n, a[1] + dy * i / n)) return false;
  return true;
}

const clampCell = ([c, r]: [number, number]): [number, number] => [Math.max(0, Math.min(GC - 1, c)), Math.max(0, Math.min(GR - 1, r))];

/** A route from one world point to another as a list of waypoints (the start is not included). */
export function findPath(fromV: { x: number; z: number }, toV: { x: number; z: number }): Vec3[] | null {
  const a = toPx(fromV), b = toPx(toV);
  const s = nearestWalk(...clampCell(cellOf(...a))), t = nearestWalk(...clampCell(cellOf(...b)));
  if (!s || !t) return null;
  const cells = astar(s, t);
  if (!cells) return null;
  const pts: Px[] = [a, ...cells.map((i): Px => [GX0 + (i % GC + .5) * CS, GY0 + ((i / GC | 0) + .5) * CS]), b];
  const out: Px[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !los(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out.slice(1).map(([x, y]) => W(x, y));
}
