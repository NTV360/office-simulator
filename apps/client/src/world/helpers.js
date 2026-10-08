import * as THREE from 'three';
import { LOW_H, S, W, wx, wz } from '@office/shared';
import { scene } from '../render/renderer.js';

/* ================= Geometry helpers ================= */
const staticRoot = new THREE.Group(); scene.add(staticRoot);
const OBS = []; // obstacle rects in plan px
const SOLIDS = []; // wall/block rects in plan px with their full height: [x1, y1, x2, y2, fullH]
const addObs = (x1, y1, x2, y2) => OBS.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
const geoCache = new Map();
function boxGeo(w, h, d) { const k = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); }
function box(parent, w, h, d, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
function cyl(parent, rt, rb, h, mat, x, y, z, seg = 16, cast = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
function rectPlane(x1, y1, x2, y2, mat, y = 0.004) {
  const g = new THREE.PlaneGeometry((x2 - x1) * S, (y2 - y1) * S);
  // world-scale UVs so textures tile at real size
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + wx((x1 + x2) / 2)), (pos.getY(i) - wz((y1 + y2) / 2)));
  const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(wx((x1 + x2) / 2), y, wz((y1 + y2) / 2)); m.receiveShadow = true; staticRoot.add(m); return m;
}
function frame(px, py, face) { const g = new THREE.Group(); g.position.copy(W(px, py)); g.rotation.y = face; staticRoot.add(g); return g; }
const dynamic = m => { m.userData.dynamic = true; return m; };

/* Things that grow with the wall-height toggle */
const scalers = [];
// Wall height: `goal` is where the toggle wants it, `h` eases toward it each frame.
const wall = { h: LOW_H, goal: LOW_H };

export { OBS, SOLIDS, addObs, box, boxGeo, cyl, dynamic, frame, rectPlane, scalers, staticRoot, wall };
