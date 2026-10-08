import { OUTER } from '../config/plan.js';
import { OBS } from '../world/helpers.js';

/* ================= Navigation grid + A* ================= */
const GX0 = 109, GY0 = 66, CS = 4.5, GC = Math.ceil((687 - GX0) / CS), GR = Math.ceil((1088 - GY0) / CS);
const NAV = new Uint8Array(GC * GR);
const MARGIN = 6;
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) {
  const x = GX0 + (c + .5) * CS, y = GY0 + (r + .5) * CS;
  let ok = inPoly(x, y, OUTER) || (x > 182 && x < 265 && y > 385 && y < 432);
  if (ok) for (const o of OBS) if (x > o[0] - MARGIN && x < o[2] + MARGIN && y > o[1] - MARGIN && y < o[3] + MARGIN) { ok = false; break; }
  NAV[r * GC + c] = ok ? 1 : 0;
}
const cellOf = (x, y) => [Math.floor((x - GX0) / CS), Math.floor((y - GY0) / CS)];
const walkPx = (x, y) => { const [c, r] = cellOf(x, y); return c >= 0 && r >= 0 && c < GC && r < GR && NAV[r * GC + c] === 1; };
function nearestWalk(c, r) {
  if (NAV[r * GC + c]) return [c, r];
  for (let rad = 1; rad < 14; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
    const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < GC && rr < GR && NAV[rr * GC + cc]) return [cc, rr];
  }
  return null;
}

export { CS, GC, GR, GX0, GY0, NAV, cellOf, nearestWalk, walkPx };
