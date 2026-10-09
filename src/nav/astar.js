import { W, toPx } from '../config/plan.js';
import { CS, GC, GR, GX0, GY0, cellOf, isOpen, nearestWalk, walkPx } from './grid.js';

const NCELLS = GC * GR, gS = new Float32Array(NCELLS), from = new Int32Array(NCELLS), seen = new Uint32Array(NCELLS), shut = new Uint32Array(NCELLS); let gen = 0;
function astar(s, t) {
  gen++; const si = s[1] * GC + s[0], ti = t[1] * GC + t[0];
  const hx = t[0], hy = t[1]; const H = i => { const dx = Math.abs(i % GC - hx), dy = Math.abs((i / GC | 0) - hy); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
  const heap = [], hf = [];
  const push = (i, f) => { heap.push(i); hf.push(f); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p; } };
  const pop = () => { const top = heap[0], li = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = li; hf[0] = lf; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m; } } return top; };
  seen[si] = gen; gS[si] = 0; from[si] = -1; push(si, H(si));
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  while (heap.length) {
    const cur = pop(); if (cur === ti) break; if (shut[cur] === gen) continue; shut[cur] = gen;
    const cx = cur % GC, cy = cur / GC | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GC || ny >= GR) continue;
      const ni = ny * GC + nx; if (!isOpen(ni)) continue;
      if (dx && dy && (!isOpen(cy * GC + nx) || !isOpen(ny * GC + cx))) continue;
      const ng = gS[cur] + cost;
      if (seen[ni] !== gen || ng < gS[ni]) { seen[ni] = gen; gS[ni] = ng; from[ni] = cur; push(ni, ng + H(ni)); }
    }
  }
  if (seen[ti] !== gen) return null;
  const out = []; for (let i = ti; i !== -1; i = from[i]) out.push(i); return out.reverse();
}
function los(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.ceil(Math.hypot(dx, dy) / .9);
  for (let i = 1; i < n; i++) if (!walkPx(a[0] + dx * i / n, a[1] + dy * i / n)) return false;
  return true;
}
function findPath(fromV, toV) {
  const a = toPx(fromV), b = toPx(toV);
  const s = nearestWalk(...cellOf(...a).map((v, i) => Math.max(0, Math.min(i ? GR - 1 : GC - 1, v)))), t = nearestWalk(...cellOf(...b).map((v, i) => Math.max(0, Math.min(i ? GR - 1 : GC - 1, v))));
  if (!s || !t) return null;
  const cells = astar(s, t); if (!cells) return null;
  const pts = [a, ...cells.map(i => [GX0 + (i % GC + .5) * CS, GY0 + ((i / GC | 0) + .5) * CS]), b];
  const out = [pts[0]]; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !los(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
  return out.slice(1).map(([x, y]) => W(x, y));
}

export { findPath };
