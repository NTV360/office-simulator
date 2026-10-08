import * as THREE from 'three';
import { W } from '../../config/plan.js';
import { TAU, rnd } from '../../core/util.js';
import { M } from '../../render/materials.js';
import { addObs, box, cyl, frame } from '../helpers.js';
import { interactables } from '../interactables.js';

/* ================= Furniture ================= */
function mkSpot(kind, px, py, face, o = {}) {
  return interactables.add({ kind, pos: W(px, py), approach: o.ap ? W(o.ap[0], o.ap[1]) : W(px, py), face, sit: !!o.sit, hipY: o.hipY ?? .53, place: o.place || '', shared: o.shared !== false, occupant: null, room: o.room });
}
const E = Math.PI / 2, WST = -Math.PI / 2, N = Math.PI, SO = 0; // facing directions: east, west, north, south

function officeChair(parent, mat = M.chairSeat) {
  const g = new THREE.Group(); parent.add(g);
  cyl(g, .27, .27, .03, M.chairBase, 0, .05, 0, 10);
  cyl(g, .028, .028, .36, M.chairBase, 0, .24, 0, 8);
  box(g, .48, .08, .46, mat, 0, .45, .02);
  const back = box(g, .46, .5, .06, mat, 0, .78, -.22); back.rotation.x = -.1;
  box(g, .04, .2, .3, M.chairBase, .25, .58, 0); box(g, .04, .2, .3, M.chairBase, -.25, .58, 0);
  return g;
}
function woodChair(f) {
  box(f, .42, .05, .42, M.diningWood, 0, .45, 0);
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => box(f, .035, .44, .035, M.diningWood2, a * .18, .22, b * .18));
  box(f, .42, .32, .035, M.diningWood2, 0, .74, -.2);
}
function barStool(f) {
  cyl(f, .2, .2, .025, M.chairBase, 0, .02, 0, 14); cyl(f, .025, .025, .68, M.steel, 0, .36, 0, 8);
  cyl(f, .19, .17, .06, M.chairSeat2, 0, .72, 0, 16);
  const r = new THREE.Mesh(new THREE.TorusGeometry(.15, .012, 6, 18), M.steel); r.rotation.x = Math.PI / 2; r.position.y = .3; f.add(r);
}
function plant(px, py, big = 1) {
  const g = frame(px, py, rnd(0, TAU));
  cyl(g, .17 * big, .13 * big, .38 * big, M.pot, 0, .19 * big, 0, 14);
  const ico = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ico, i % 2 ? M.leaf : M.leaf2); const s = rnd(.14, .24) * big;
    m.scale.set(s, s * 1.4, s); m.position.set(rnd(-.12, .12) * big, (.5 + i * .11) * big, rnd(-.12, .12) * big); m.rotation.set(rnd(0, 3), rnd(0, 3), 0); m.castShadow = true; g.add(m);
  }
  addObs(px - 6 * big, py - 6 * big, px + 6 * big, py + 6 * big);
}

export { E, N, SO, WST, barStool, mkSpot, officeChair, plant, woodChair };
