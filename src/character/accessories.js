import * as THREE from 'three';
import { TAU } from '../core/util.js';
import { boxGeo } from '../world/helpers.js';
import { dsMat, eyeMat, sph, stdMat } from './gfx.js';

// Worn extras. Like the parts in parts.js, each takes the head (or torso) group and the CharacterSpec.
// Add a hat or costume by adding an entry to HATS / COSTUMES and its name to HAT_OPTIONS / COSTUME_OPTIONS in spec.js.
// (The ghost costume is not here: it makes the body's own materials see-through, see tintOf in gfx.js.)
const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

const HATS = {
  pilot: (head, hm) => {
    head.add(mesh(new THREE.CylinderGeometry(.15, .165, .1, 18), hm, 0, .265, -.01));
    head.add(mesh(boxGeo(.26, .012, .12), stdMat('#15171c', .4), 0, .215, .13));        // peak
    head.add(mesh(boxGeo(.04, .035, .01), stdMat('#f0c040', .4), 0, .27, .158));        // badge
  },
  grad: (head, hm) => {
    head.add(mesh(new THREE.CylinderGeometry(.13, .14, .07, 16), hm, 0, .285, 0));
    head.add(mesh(boxGeo(.36, .025, .36), hm, 0, .33, 0));                              // mortarboard
    head.add(mesh(new THREE.CylinderGeometry(.005, .005, .12, 5), stdMat('#f0c040', .4), .16, .27, .16)); // tassel
  },
  beanie: (head, hm, spec) => {
    const c = mesh(new THREE.SphereGeometry(.158, 18, 10, 0, TAU, 0, Math.PI * .42), hm, 0, .14, -.005); c.scale.set(1, 1.1, 1.04); c.castShadow = true; head.add(c);
    head.add(mesh(new THREE.CylinderGeometry(.152, .152, .05, 18, 1, true), dsMat(spec.hatBand, .9), 0, .195, -.003)); // folded rim
  },
  hood: (head, hm) => {
    const back = mesh(sph(.17, 14, 10), hm, 0, .13, -.07); back.scale.set(1.05, 1.05, .9); head.add(back);
    head.add(mesh(new THREE.TorusGeometry(.125, .04, 8, 18), hm, 0, .12, .02));          // face opening
  },
};

function addHat(head, spec) {
  const make = spec.hat && HATS[spec.hat]; if (!make) return;
  make(head, stdMat(spec.hatColor, .7), spec);
}

function addGoggles(head, spec) {
  if (!spec.goggles) return;
  const gm = stdMat(spec.goggles, .4), lm = stdMat(spec.gogglesLens, .2);
  head.add(mesh(new THREE.CylinderGeometry(.141, .141, .045, 18, 1, true), dsMat(spec.goggles, .4), 0, .14, 0)); // strap
  head.add(mesh(boxGeo(.2, .075, .02), gm, 0, .14, .136));                                                   // frame
  head.add(mesh(boxGeo(.17, .05, .01), lm, 0, .14, .148));                                                   // lens
}

function addEarrings(head, spec) {
  if (!spec.earrings) return;
  const em = stdMat(spec.earrings, .3);
  [-1, 1].forEach(sd => [.09, .045].forEach(y => head.add(mesh(sph(.014, 8, 6), em, sd * .138, y, .01))));
}

function addScarf(torso, spec) {
  if (!spec.scarf) return;
  const sm = stdMat(spec.scarf, .9), r = mesh(new THREE.TorusGeometry(.105, .04, 8, 18), sm, 0, .52, 0);
  r.rotation.x = Math.PI / 2; r.scale.set(1.1, 1.1, .9); r.castShadow = true; torso.add(r);
  const tail = mesh(boxGeo(.07, .2, .025), sm, .06, .4, .12); tail.rotation.z = .08; torso.add(tail);
}

function addTie(torso, spec) {
  if (!spec.tie) return;
  const tm = stdMat(spec.tie, .6), z = spec.jacket ? .13 : .118; // sit in front of a jacket, not inside it
  torso.add(mesh(boxGeo(.03, .14, .012), tm, 0, .37, z));
  torso.add(mesh(boxGeo(.034, .03, .016), tm, 0, .45, z));
}

const COSTUMES = {
  vampire: (head, torso) => {
    const cm = stdMat('#7a1a22', .7);
    const cape = mesh(boxGeo(.42, .62, .03), cm, 0, .2, -.13); cape.rotation.x = .06; torso.add(cape);
    const collar = mesh(boxGeo(.4, .2, .03), cm, 0, .5, -.1); collar.rotation.x = -.35; torso.add(collar);
    const fang = new THREE.ConeGeometry(.009, .03, 6);
    [-1, 1].forEach(sd => { const f = mesh(fang, stdMat('#ffffff', .3), sd * .022, .062, .13); f.rotation.x = Math.PI; head.add(f); });
  },
  snowman: head => {
    const nose = mesh(new THREE.ConeGeometry(.02, .11, 8), stdMat('#f08a1c', .6), 0, .105, .19); nose.rotation.x = Math.PI / 2; head.add(nose);
  },
  frank: head => {
    head.add(mesh(boxGeo(.3, .2, .27), stdMat('#2a2a30', .9), 0, .36, -.01));            // flat head
    head.add(mesh(boxGeo(.04, .2, .275), stdMat('#d8e0e8', .8), .09, .36, -.01));        // stitched seam
    const bm = stdMat('#9aa4ad', .4);
    [-1, 1].forEach(sd => { const b = mesh(new THREE.CylinderGeometry(.014, .014, .08, 8), bm, sd * .17, .04, 0); b.rotation.z = Math.PI / 2; head.add(b); head.add(mesh(sph(.02, 8, 6), bm, sd * .215, .04, 0)); }); // neck bolts
  },
  wolf: head => {
    const wm = stdMat('#6c6872', .9);
    [-1, 1].forEach(sd => { const e = mesh(new THREE.ConeGeometry(.05, .14, 4), wm, sd * .09, .31, -.02); e.rotation.z = -sd * .3; head.add(e); });
    const snout = mesh(sph(.06, 10, 8), stdMat('#c8d0e0', .8), 0, .085, .14); snout.scale.set(.95, .7, 1.3); head.add(snout);
    head.add(mesh(sph(.018, 8, 6), eyeMat, 0, .1, .205));
  },
};

function addCostume(head, torso, spec) {
  const make = spec.costume && COSTUMES[spec.costume]; if (make) make(head, torso);
}

export { COSTUMES, HATS, addCostume, addEarrings, addGoggles, addHat, addScarf, addTie };
