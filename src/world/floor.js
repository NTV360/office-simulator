import * as THREE from 'three';
import { FRONT_Y, OUTER, S, wx, wz } from '../config/plan.js';
import { M } from '../render/materials.js';
import { groundMat, scene } from '../render/renderer.js';
import { rectPlane, staticRoot } from './helpers.js';


function buildFloor() {
  
  /* ================= Floor ================= */
  {
    const shape = new THREE.Shape(OUTER.map(([x, y]) => new THREE.Vector2(wx(x), -wz(y))));
    const slab = new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: false });
    slab.rotateX(-Math.PI / 2); slab.translate(0, -.14, 0);
    const m = new THREE.Mesh(slab, [M.floor, M.slab]); m.receiveShadow = true; staticRoot.add(m);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.15; ground.receiveShadow = true; scene.add(ground);
    // entrance walkway outside
    const pad = new THREE.Mesh(new THREE.BoxGeometry((266 - 181) * S, .1, (436 - 390) * S), M.pad);
    pad.position.set(wx(223.5), -.09, wz(FRONT_Y + 24)); pad.receiveShadow = true; staticRoot.add(pad);
    rectPlane(198, FRONT_Y + 3, 249, FRONT_Y + 14, M.mat, -0.035);
    // zone floors
    rectPlane(115.5, 72.8, 261.3, 192, M.carpet); rectPlane(264.5, 72.8, 398.4, 192, M.carpet); rectPlane(115.5, 195.2, 217, 327.4, M.carpet); // Conference 3 runs down to y 329
    rectPlane(482.3, 894.5, 681, 937.8, M.boothFloor);
    rectPlane(353.4, 950, 680.6, 1081.7, M.wood); rectPlane(439, 1081, 680.6, 1111.4, M.wood); rectPlane(272.8, 1040.5, 350.2, 1081.7, M.boothFloor);
    rectPlane(334, 298, 410, 380, M.rug);
  }
}

export { buildFloor };
