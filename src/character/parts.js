import * as THREE from 'three';
import { boxGeo } from '../world/helpers.js';
import { sph, stdMat } from './gfx.js';

// Face parts the character pack does not have. The pack draws hair, faces, clothes and accessories;
// add new looks there (pack/README.md, "Adding your own parts") and use this file only for our own.

const ray = new THREE.Raycaster(), back = new THREE.Vector3(0, 0, -1), from = new THREE.Vector3();

// A furious face over the pack's own: slanted brows, a frown and flushed cheeks. `faceMeshes` are the
// head's skin meshes; the character stands at rest at the origin facing +z, so parts are placed in world
// space on the face surface (found with a ray from the front) and then attached to the head.
function addAngry(head, faceMeshes) {
  const face = new THREE.Box3(); faceMeshes.forEach(m => face.expandByObject(m));
  const w = face.max.x - face.min.x, h = face.max.y - face.min.y, cy = face.min.y + h * .5;
  const onFace = (m, x, y, out = .006) => {
    ray.set(from.set(x, y, face.max.z + 1), back);
    const hit = ray.intersectObjects(faceMeshes, false)[0];
    m.position.set(x, y, (hit ? hit.point.z : face.max.z) + out); head.attach(m);
  };
  const bm = stdMat('#1d1714', .6);
  [-1, 1].forEach(sd => { const b = new THREE.Mesh(boxGeo(w * .26, h * .06, .012), bm); b.rotation.z = sd * .5; onFace(b, sd * w * .2, cy + h * .2); });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(w * .09, h * .02, 6, 12, Math.PI), stdMat('#6b2a2a', .6)); onFace(mouth, 0, cy - h * .24);
  [-1, 1].forEach(sd => { const c = new THREE.Mesh(sph(.018, 8, 6), stdMat('#d9705f', .8)); c.scale.set(w * 5, w * 3, 1.5); onFace(c, sd * w * .3, cy - h * .08, 0); });
}

export { addAngry };
