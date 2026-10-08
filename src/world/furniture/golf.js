import * as THREE from 'three';
import { S, W, wx, wz } from '../../config/plan.js';
import { M } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, mkSpot } from './basics.js';
import { box, cyl, staticRoot } from '../helpers.js';
import { interactables } from '../interactables.js';

function updateGolf() {
  for (const g of GOLF_BALLS) {
    const p = g.spot.occupant, b = g.ball;
    if (!p || p.state !== 'doing') { b.position.set(g.start.x, .05, g.start.z); b.visible = true; continue; }
    const ph = (p.animT + g.spot.pos.z) % 8;
    if (ph < 1.4) { b.position.set(g.start.x, .05, g.start.z); b.visible = true; }
    else if (ph < 4) { const k = 1 - Math.pow(1 - (ph - 1.4) / 2.6, 2.2); b.position.set(g.start.x + (GOLF_HOLE.x - g.start.x) * k, .05, g.start.z + (GOLF_HOLE.z - g.start.z) * k); b.visible = true; }
    else b.visible = false;
  }
}

let GOLF_HOLE, GOLF_BALLS;

function buildGolf() {
  
  // Mini golf: one simple straight putting strip along the east wall
  GOLF_HOLE = W(667, 982);
  GOLF_BALLS = [];
  {
    const x1 = 655, x2 = 679, y1 = 970, y2 = 1066;
    const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
    box(staticRoot, w, .025, d, M.turf, cx, .0125, cz, false);
    box(staticRoot, w, .07, .05, M.diningWood2, cx, .035, wz(y1));
    box(staticRoot, .05, .07, d, M.diningWood2, wx(x1), .035, cz);
    box(staticRoot, .05, .07, d, M.diningWood2, wx(x2), .035, cz);
    cyl(staticRoot, .055, .055, .006, M.chairBase, GOLF_HOLE.x, .029, GOLF_HOLE.z, 18, false);
    cyl(staticRoot, .007, .007, 1.0, M.white, GOLF_HOLE.x, .52, GOLF_HOLE.z, 6);
    const flag = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -.18, 0), new THREE.Vector3(.26, -.09, 0)]), M.flag);
    flag.geometry.computeVertexNormals(); flag.position.set(GOLF_HOLE.x, 1.02, GOLF_HOLE.z); flag.userData.dynamic = true; scene.add(flag);
    box(staticRoot, .3, .005, .3, M.turfDark, wx(667), .028, wz(1054), false);
    mkSpot('golf', 659, 1054, E, { place: 'the putting strip' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.022, 12, 10), M.white); ball.castShadow = true; scene.add(ball);
    const start = W(667, 1054); ball.position.set(start.x, .05, start.z);
    GOLF_BALLS.push({ ball, start, spot: interactables.of('golf')[0] });
  }
}

export { updateGolf, buildGolf };
