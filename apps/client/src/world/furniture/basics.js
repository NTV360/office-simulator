import * as THREE from 'three';
import { mkSpot, vrnd } from '@office/shared';
import { M } from '../../render/materials.js';
import { box, cyl } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

/* ================= Furniture ================= */
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
// A baby high chair, the kind toddlers eat in: splayed legs, a raised padded seat, a footrest and a tray. Hazel's seat (HAZEL_DESK in
// shared/layout/desks.ts); it is the office chair item's third look (variant 2, render/objects.js), so it is a chair like any other. Same frame
// as officeChair: +z faces the desk.
const HIGH = { frame: new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: .45 }), pad: new THREE.MeshStandardMaterial({ color: 0x9fd0e4, roughness: .8 }) };
function highChair(f) {
  const g = new THREE.Group(); f.add(g);
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const leg = box(g, .035, .74, .035, HIGH.frame, sx * .2, .36, sz * .18); leg.rotation.set(-sz * .14, 0, sx * .14); // feet splayed out wider than the seat
  });
  box(g, .5, .03, .03, HIGH.frame, 0, .02, .23); box(g, .5, .03, .03, HIGH.frame, 0, .02, -.23); // floor bars between the feet
  box(g, .3, .03, .04, HIGH.frame, 0, .32, .2);                   // footrest
  box(g, .36, .05, .32, HIGH.frame, 0, .66, 0);                   // seat
  box(g, .32, .03, .28, HIGH.pad, 0, .695, 0);                    // seat cushion
  box(g, .34, .34, .05, HIGH.frame, 0, .86, -.15); box(g, .3, .3, .02, HIGH.pad, 0, .86, -.12); // padded back
  [-1, 1].forEach(s => box(g, .03, .14, .26, HIGH.frame, s * .18, .76, .0));                     // side rails
  box(g, .42, .025, .2, HIGH.frame, 0, .84, .22);                 // the eating tray
  box(g, .42, .03, .02, HIGH.frame, 0, .855, .32);                // tray lip
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
/** A floor plant, `big` times the usual size, drawn at the origin of `g` (the leaves fall differently on every page: they are only looks). */
function drawPlant(g, big = 1) {
  cyl(g, .17 * big, .13 * big, .38 * big, M.pot, 0, .19 * big, 0, 14);
  const ico = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ico, i % 2 ? M.leaf : M.leaf2); const s = vrnd(.14, .24) * big;
    m.scale.set(s, s * 1.4, s); m.position.set(vrnd(-.12, .12) * big, (.5 + i * .11) * big, vrnd(-.12, .12) * big); m.rotation.set(vrnd(0, 3), vrnd(0, 3), 0); m.castShadow = true; g.add(m);
  }
}
/** A floor plant is an item (shared/world/shapes.ts): it blocks walking where it stands, and can be carried. */
const plant = (px, py, big = 1) => placeLater(() => placeObject('plant-floor', px, py, 0, { dims: [big] }));

export { E, N, SO, WST, barStool, drawPlant, highChair, mkSpot, officeChair, plant, woodChair };
