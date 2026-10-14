import * as THREE from 'three';
import { boxGeo } from '../world/helpers.js';
import { sph, stdMat } from './gfx.js';

// Face parts the character pack does not have. The pack draws hair, faces, clothes and accessories;
// add new looks there (pack/README.md, "Adding your own parts") and use this file only for our own.

const ray = new THREE.Raycaster(), back = new THREE.Vector3(0, 0, -1), from = new THREE.Vector3();

// Hazel's faces (the pack's own eyes, brows and mouth are taken off first, see rig.js hazelize). Each is a group
// on the head and only one shows at a time (rig.js showFace):
// - angry: slanted brows, narrowed eyes, a hard frown and flushed cheeks (the default);
// - laugh: raised brows, eyes squeezed shut, a wide open mouth;
// - worried: brows up in the middle, wide eyes, a wobbly mouth and a drop of sweat.
// `faceMeshes` are the head's skin meshes; the character stands at rest at the origin facing +z, so parts are
// placed in world space on the face surface (found with a ray from the front) and then attached.
function addFaces(head, faceMeshes) {
  const face = new THREE.Box3(); faceMeshes.forEach(m => face.expandByObject(m));
  const w = face.max.x - face.min.x, h = face.max.y - face.min.y, cy = face.min.y + h * .5;
  const dark = stdMat('#1d1714', .6), white = stdMat('#ffffff', .4), lip = stdMat('#6b2a2a', .6), blush = stdMat('#d9705f', .8);
  const box = (x, y, m) => new THREE.Mesh(boxGeo(x, y, .01), m);
  const group = build => {
    const g = new THREE.Group(); head.add(g);
    build((m, x, y, out = .006) => {
      ray.set(from.set(x, y, face.max.z + 1), back);
      const hit = ray.intersectObjects(faceMeshes, false)[0];
      m.position.set(x, y, (hit ? hit.point.z : face.max.z) + out); g.attach(m);
    });
    return g;
  };
  const brows = (on, tilt, y) => [-1, 1].forEach(sd => { const b = box(w * .26, h * .06, dark); b.rotation.z = sd * tilt; on(b, sd * w * .2, cy + y); });
  const cheeks = on => [-1, 1].forEach(sd => { const c = new THREE.Mesh(sph(.018, 8, 6), blush); c.scale.set(w * 5, w * 3, 1.5); on(c, sd * w * .3, cy - h * .08, 0); });

  const angry = group(on => {
    brows(on, .5, h * .2);
    [-1, 1].forEach(sd => { on(box(w * .2, h * .08, white), sd * w * .2, cy + h * .08, .004); on(box(w * .08, h * .08, dark), sd * w * .18, cy + h * .08, .009); });
    on(box(w * .28, h * .045, lip), 0, cy - h * .22);
    [-1, 1].forEach(sd => on(box(w * .06, h * .09, lip), sd * w * .15, cy - h * .26));
    cheeks(on);
  });
  const laugh = group(on => {
    brows(on, -.15, h * .26);
    // eyes shut tight: a ^ on each side
    [-1, 1].forEach(sd => [-1, 1].forEach(k => { const e = box(w * .12, h * .04, dark); e.rotation.z = -k * .6; on(e, sd * w * .2 + k * w * .045, cy + h * .09); }));
    on(box(w * .34, h * .16, stdMat('#3a1414', .7)), 0, cy - h * .22);
    on(box(w * .2, h * .05, stdMat('#d95b5b', .7)), 0, cy - h * .27, .009);
    on(box(w * .3, h * .035, white), 0, cy - h * .155, .009);
    cheeks(on);
  });
  const worried = group(on => {
    brows(on, -.45, h * .24);
    [-1, 1].forEach(sd => { on(box(w * .18, h * .14, white), sd * w * .2, cy + h * .08, .004); on(box(w * .06, h * .07, dark), sd * w * .2, cy + h * .07, .009); });
    [-2, -1, 0, 1, 2].forEach(i => on(box(w * .07, h * .035, lip), i * w * .06, cy - h * (.23 + (i % 2 ? .025 : 0))));
    const drop = new THREE.Mesh(sph(.02, 8, 6), stdMat('#8fd0f0', .2)); drop.scale.set(.8, 1.3, .8); on(drop, w * .4, cy + h * .28, .01);
  });
  laugh.visible = worried.visible = false;
  return { angry, laugh, worried };
}

export { addFaces };
