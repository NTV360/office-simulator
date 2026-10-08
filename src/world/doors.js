import * as THREE from 'three';
import { S, W, wx, wz } from '../config/plan.js';
import { M } from '../render/materials.js';
import { scene } from '../render/renderer.js';
import { box, dynamic, scalers, staticRoot } from './helpers.js';

function doorLeaf(px, py, widthPx, rot, dir, mat = M.wall, fullH = 2.1) {
  const g = new THREE.Group(); g.position.copy(W(px, py)); g.rotation.y = rot; scene.add(g);
  const w = widthPx * S; const geo = new THREE.BoxGeometry(w, 1, .04); geo.translate(dir * w / 2, .5, 0);
  const leaf = dynamic(new THREE.Mesh(geo, mat)); leaf.castShadow = true; g.add(leaf);
  scalers.push(H => { leaf.scale.y = Math.min(fullH, H); });
}
doorLeaf(236, 193.6, 24, 1.3, 1);                    // Conference 1
doorLeaf(299, 193.6, 25, -1.3, -1);                  // Conference 2
doorLeaf(218.5, 224, 24, Math.PI / 2 + 1.25, 1);     // Conference 3
doorLeaf(351.8, 1062, 21, Math.PI / 2 + 1.25, 1);    // Storage
doorLeaf(189.6, 389, 33, -1.15, 1, M.glass, 2.4);    // entrance, glass pair
doorLeaf(257.4, 389, 33, 1.15, -1, M.glass, 2.4);
[189.6, 257.4].forEach(x => { box(staticRoot, .1, 2.4, .1, M.cap, wx(x), 1.2, wz(389)); });

export { doorLeaf };
