import * as THREE from 'three';
import { CATS } from '../people/data.js';
import { boxGeo } from '../world/helpers.js';
import { addGlasses, addHair, addHeadphones } from './parts.js';
import { eyeMat, limb, sph, stdMat } from './gfx.js';

const ringGeo = new THREE.RingGeometry(.27, .33, 32);
const ringMats = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: .85, depthWrite: false })]));


// Build the shared character rig for a CharacterSpec. Returns the mesh groups plus the joints and props
// the animation code drives. `sockets` are attach points for future held/worn items.
function buildBody(spec) {
  const skin = stdMat(spec.skin, .65), shirt = stdMat(spec.shirt), pants = stdMat(spec.pants, .85), shoe = stdMat(spec.shoes, .6);
  const root = new THREE.Group(); root.scale.setScalar(spec.scale);
  const hips = new THREE.Group(); hips.position.y = .88; root.add(hips);
  const pelvis = new THREE.Mesh(sph(.16), pants); pelvis.scale.set(1.05, .62, .78); pelvis.castShadow = true; hips.add(pelvis);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(.155, .26, 4, 12), shirt); chest.position.y = .28; chest.scale.set(1.15, 1, .74); chest.castShadow = true; torso.add(chest);
  if (spec.jacket) { const j = new THREE.Mesh(new THREE.CapsuleGeometry(.162, .22, 4, 12, ), stdMat(spec.jacket)); j.position.y = .27; j.scale.set(1.17, 1, .77); j.castShadow = true; torso.add(j); const sh = new THREE.Mesh(sph(.06), shirt); sh.position.set(0, .45, .095); sh.scale.set(1, 1.4, .4); torso.add(sh); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.048, .055, .1, 10), skin); neck.position.y = .55; torso.add(neck);
  const head = new THREE.Group(); head.position.y = .6; torso.add(head);
  const skull = new THREE.Mesh(sph(.135, 20, 16), skin); skull.position.y = .13; skull.scale.set(1, 1.08, 1.02); skull.castShadow = true; head.add(skull);
  [-1, 1].forEach(s => { const e = new THREE.Mesh(sph(.017, 8, 6), eyeMat); e.position.set(s * .047, .14, .128); head.add(e); const ear = new THREE.Mesh(sph(.03, 8, 6), skin); ear.position.set(s * .135, .12, 0); ear.scale.set(.5, 1, .8); head.add(ear); });
  const nose = new THREE.Mesh(sph(.022, 8, 6), skin); nose.position.set(0, .11, .138); head.add(nose);
  addHair(head, spec); addGlasses(head, spec); addHeadphones(head, spec);
  const sleeve = spec.longSleeve ? (spec.jacket ? stdMat(spec.jacket) : shirt) : skin;
  const arm = side => {
    const sh = new THREE.Group(); sh.position.set(side * .205, .46, 0); torso.add(sh);
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(.056, .17, 4, 10), spec.jacket ? stdMat(spec.jacket) : shirt); up.position.y = -.14; up.castShadow = true; sh.add(up);
    const el = new THREE.Group(); el.position.y = -.28; sh.add(el);
    el.add(limb(.047, .26, sleeve));
    const hand = new THREE.Group(); hand.position.y = -.27; el.add(hand);
    const hm = new THREE.Mesh(sph(.05, 10, 8), skin); hm.scale.set(.85, 1.1, .7); hm.castShadow = true; hand.add(hm);
    return { sh, el, hand };
  };
  const L = arm(1), R = arm(-1);
  const leg = side => {
    const hp = new THREE.Group(); hp.position.set(side * .095, -.02, 0); hips.add(hp);
    hp.add(limb(.076, .43, pants));
    const kn = new THREE.Group(); kn.position.y = -.43; hp.add(kn);
    kn.add(limb(.064, .41, pants));
    const s = new THREE.Mesh(boxGeo(.11, .075, .25), shoe); s.position.set(0, -.405, .045); s.castShadow = true; kn.add(s);
    return { hp, kn };
  };
  const LL = leg(1), RL = leg(-1);
  // props
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(.04, .035, .09, 12), stdMat('#ffffff', .4)); mug.position.set(0, -.05, .05); mug.visible = false; R.hand.add(mug);
  const phone = new THREE.Mesh(boxGeo(.045, .1, .012), stdMat('#15191d', .3)); phone.position.set(0, -.04, .04); phone.visible = false; R.hand.add(phone);
  const ring = new THREE.Mesh(ringGeo, ringMats.work); ring.rotation.x = -Math.PI / 2; ring.position.y = .015; ring.renderOrder = 2;
  const putter = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .8, 6), stdMat('#c6ced4', .3)); shaft.position.y = -.42; putter.add(shaft);
  const pgrip = new THREE.Mesh(new THREE.CylinderGeometry(.015, .013, .14, 8), stdMat('#22272c', .6)); pgrip.position.y = -.06; putter.add(pgrip);
  const phead = new THREE.Mesh(boxGeo(.11, .03, .04), stdMat('#2a3036', .4)); phead.position.set(.035, -.82, 0); putter.add(phead);
  putter.position.set(0, -.02, .02); putter.visible = false; R.hand.add(putter);
  const pad = new THREE.Group(); const pw = stdMat('#eef0f2', .4), pk = stdMat('#22272c', .4);
  pad.add(new THREE.Mesh(boxGeo(.15, .028, .07), pw));
  [-1, 1].forEach(sd => { const gp = new THREE.Mesh(sph(.03, 8, 6), pw); gp.position.set(sd * .066, -.006, -.03); gp.scale.set(1, .8, 1.5); pad.add(gp); });
  const tp = new THREE.Mesh(boxGeo(.065, .006, .035), pk); tp.position.set(0, .016, .005); pad.add(tp);
  pad.position.set(.08, -.07, .05); pad.visible = false; R.hand.add(pad);
  const sockets = { head, torso, leftHand: L.hand, rightHand: R.hand };
  return { root, hips, torso, head, L, R, LL, RL, mug, phone, pad, putter, ring, sockets };
}

export { buildBody, ringMats };
