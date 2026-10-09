import * as THREE from 'three';
import { FULL_H, GLASS_WALLS, S, W, WALLS, WALL_T, wx, wz } from '../config/plan.js';
import { pick } from '../core/util.js';
import { M } from '../render/materials.js';
import { scene } from '../render/renderer.js';
import { SOLIDS, addObs, boxGeo, dynamic, scalers } from './helpers.js';

/* ================= Walls and doors ================= */
function wallSeg(x1, y1, x2, y2, mat = M.wall, fullH = FULL_H, thick = WALL_T, capMat = M.cap) {
  const h = thick / 2;
  const r = x1 === x2 ? [x1 - h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h] : [Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 + h];
  solidBlock(...r, mat, fullH, capMat);
}
// A glass partition: a clear pane on a low frame strip, with the dark cap on top like the other walls.
// It blocks walking and the third-person camera like any wall.
function glassWall(x1, y1, x2, y2) {
  wallSeg(x1, y1, x2, y2, M.glass, FULL_H, WALL_T * .5);
  const h = WALL_T * .3, r = x1 === x2 ? [x1 - h, Math.min(y1, y2), x1 + h, Math.max(y1, y2)] : [Math.min(x1, x2), y1 - h, Math.max(x1, x2), y1 + h];
  const base = dynamic(new THREE.Mesh(boxGeo((r[2] - r[0]) * S, .08, (r[3] - r[1]) * S), M.mullion));
  base.position.set(wx((r[0] + r[2]) / 2), .04, wz((r[1] + r[3]) / 2)); scene.add(base);
}
function solidBlock(x1, y1, x2, y2, mat = M.wall, fullH = FULL_H, capMat = M.cap) {
  addObs(x1, y1, x2, y2);
  SOLIDS.push([x1, y1, x2, y2, fullH]);
  const w = (x2 - x1) * S, d = (y2 - y1) * S, cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2);
  const g = new THREE.BoxGeometry(w, 1, d); g.translate(0, .5, 0);
  const body = dynamic(new THREE.Mesh(g, mat)); body.position.set(cx, 0, cz); body.castShadow = !mat.transparent; body.receiveShadow = true; scene.add(body);
  const cap = dynamic(new THREE.Mesh(boxGeo(w + .004, .035, d + .004), capMat)); cap.position.set(cx, 0, cz); cap.castShadow = false; scene.add(cap);
  scalers.push(H => { const hh = Math.min(fullH, H); body.scale.y = hh; cap.position.y = hh + .017; });
}
// Windows on the outer walls: [wall line is vertical?, line coord, from, to]
const WINDOWS = [
  [true, 682.2, 120, 300], [true, 682.2, 460, 670], [true, 682.2, 790, 880], [true, 682.2, 950, 1100],
  [false, 70.8, 130, 245], [false, 70.8, 280, 375], [false, 70.8, 420, 660],
];
function splitForWindows(walls) {
  let out = walls.map(w => w.slice());
  for (const [vert, line, a, b] of WINDOWS) {
    const next = [];
    for (const w of out) {
      const [x1, y1, x2, y2] = w, isV = x1 === x2;
      const on = vert ? (isV && Math.abs(x1 - line) < .01) : (!isV && Math.abs(y1 - line) < .01);
      const lo = vert ? Math.min(y1, y2) : Math.min(x1, x2), hi = vert ? Math.max(y1, y2) : Math.max(x1, x2);
      if (!on || b <= lo || a >= hi) { next.push(w); continue; }
      if (a > lo) next.push(vert ? [line, lo, line, a] : [lo, line, a, line]);
      if (b < hi) next.push(vert ? [line, b, line, hi] : [b, line, hi, line]);
    }
    out = next;
  }
  return out;
}


function buildWalls() {
  splitForWindows(WALLS).forEach(s => wallSeg(...s));
  GLASS_WALLS.forEach(s => glassWall(...s));
  WINDOWS.forEach(([vert, line, a, b]) => {
    const len = (b - a) * S, T = WALL_T * S;
    if (vert) addObs(line - WALL_T / 2, a, line + WALL_T / 2, b); else addObs(a, line - WALL_T / 2, b, line + WALL_T / 2);
    const c = vert ? W(line, (a + b) / 2) : W((a + b) / 2, line);
    const grp = new THREE.Group(); grp.position.copy(c); grp.rotation.y = vert ? 0 : Math.PI / 2; scene.add(grp);
    const sill = dynamic(new THREE.Mesh(boxGeo(T, .55, len), M.wall)); sill.position.y = .275; sill.castShadow = true; sill.receiveShadow = true; grp.add(sill);
    const ledge = dynamic(new THREE.Mesh(boxGeo(T + .08, .04, len), M.mullion)); ledge.position.y = .57; grp.add(ledge);
    const up = new THREE.Group(); up.position.y = .59; grp.add(up);
    const glass = dynamic(new THREE.Mesh(boxGeo(.03, 1, len), M.glass)); up.add(glass);
    const n = Math.max(2, Math.round(len / 1.2)), posts = [];
    for (let i = 0; i <= n; i++) { const pm = dynamic(new THREE.Mesh(boxGeo(.07, 1, .05), M.mullion)); pm.position.z = -len / 2 + i * len / n; pm.castShadow = true; up.add(pm); posts.push(pm); }
    const top = dynamic(new THREE.Mesh(boxGeo(T + .02, .05, len), M.cap)); up.add(top);
    // Venetian blinds on the inside face, one per bay, each lowered a different amount
    const inX = -(T / 2 + .06), bayW = len / n - .05;
    const rail = dynamic(new THREE.Mesh(boxGeo(.07, .06, len - .02), M.blindRail)); rail.position.x = inX; up.add(rail);
    const bays = [];
    for (let i = 0; i < n; i++) {
      const zc = -len / 2 + (i + .5) * len / n;
      const mat = M.blind.clone(); mat.map = M.blind.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.needsUpdate = true;
      const panel = dynamic(new THREE.Mesh(new THREE.BoxGeometry(.012, 1, bayW), mat)); panel.position.set(inX, 0, zc); panel.castShadow = true; up.add(panel);
      const bottom = dynamic(new THREE.Mesh(boxGeo(.03, .025, bayW), M.blindRail)); bottom.position.set(inX, 0, zc); up.add(bottom);
      const cord = dynamic(new THREE.Mesh(boxGeo(.006, 1, .006), M.blindRail)); cord.position.set(inX - .015, 0, zc + bayW / 2 - .06); up.add(cord);
      bays.push({ panel, bottom, cord, mat, drop: pick([.25, .35, .5, .5, .65, .8]) });
    }
    scalers.push(H => {
      const hh = Math.max(.05, H - .59); glass.scale.y = hh; glass.position.y = hh / 2; posts.forEach(pm => { pm.scale.y = hh; pm.position.y = hh / 2; }); top.position.y = hh;
      rail.position.y = hh - .05;
      for (const bb of bays) {
        const bh = Math.max(.02, (hh - .08) * bb.drop), y = hh - .08 - bh / 2;
        bb.panel.scale.y = bh; bb.panel.position.y = y; bb.mat.map.repeat.set(1, Math.max(1, bh / .045));
        bb.bottom.position.y = hh - .08 - bh; bb.cord.scale.y = Math.max(.02, hh * .55); bb.cord.position.y = hh - .08 - hh * .275;
      }
    });
  });
  solidBlock(383.3, 70.8, 400, 100.8, M.wall);
  // the wall behind the lounge TV: a square as wide as the TV (y 322-368), keeping the face the TV hangs on
  solidBlock(266.3, 322.55, 312.3, 368.55, M.featureWall, FULL_H, M.deskEdge);
}

export { wallSeg, buildWalls };
