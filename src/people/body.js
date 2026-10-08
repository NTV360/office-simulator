import * as THREE from 'three';
import { TAU } from '../core/util.js';
import { CATS } from './data.js';
import { boxGeo } from '../world/helpers.js';

const ringGeo = new THREE.RingGeometry(.27, .33, 32);
const ringMats = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: .85, depthWrite: false })]));

const matCache = new Map();
const stdMat = (hex, rough = .75) => { const k = hex + rough; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough })); return matCache.get(k); };
const capsCache = new Map();
function limb(r, len, mat) {
  const k = r + '_' + len; if (!capsCache.has(k)) capsCache.set(k, new THREE.CapsuleGeometry(r, Math.max(.01, len - 2 * r), 4, 10));
  const m = new THREE.Mesh(capsCache.get(k), mat); m.position.y = -len / 2; m.castShadow = true; return m;
}
const sph = (r, ws = 16, hs = 12) => { const k = 's' + r + ws; if (!capsCache.has(k)) capsCache.set(k, new THREE.SphereGeometry(r, ws, hs)); return capsCache.get(k); };
const eyeMat = stdMat('#1b1f24', .3);

function buildBody(look) {
  const skin = stdMat(look.skin, .65), shirt = stdMat(look.shirt), pants = stdMat(look.pants, .85), hair = stdMat(look.hair, .9), shoe = stdMat(look.shoes, .6);
  const root = new THREE.Group(); root.scale.setScalar(look.scale);
  const hips = new THREE.Group(); hips.position.y = .88; root.add(hips);
  const pelvis = new THREE.Mesh(sph(.16), pants); pelvis.scale.set(1.05, .62, .78); pelvis.castShadow = true; hips.add(pelvis);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(.155, .26, 4, 12), shirt); chest.position.y = .28; chest.scale.set(1.15, 1, .74); chest.castShadow = true; torso.add(chest);
  if (look.jacket) { const j = new THREE.Mesh(new THREE.CapsuleGeometry(.162, .22, 4, 12, ), stdMat(look.jacket)); j.position.y = .27; j.scale.set(1.17, 1, .77); j.castShadow = true; torso.add(j); const sh = new THREE.Mesh(sph(.06), shirt); sh.position.set(0, .45, .095); sh.scale.set(1, 1.4, .4); torso.add(sh); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.048, .055, .1, 10), skin); neck.position.y = .55; torso.add(neck);
  const head = new THREE.Group(); head.position.y = .6; torso.add(head);
  const skull = new THREE.Mesh(sph(.135, 20, 16), skin); skull.position.y = .13; skull.scale.set(1, 1.08, 1.02); skull.castShadow = true; head.add(skull);
  [-1, 1].forEach(s => { const e = new THREE.Mesh(sph(.017, 8, 6), eyeMat); e.position.set(s * .047, .14, .128); head.add(e); const ear = new THREE.Mesh(sph(.03, 8, 6), skin); ear.position.set(s * .135, .12, 0); ear.scale.set(.5, 1, .8); head.add(ear); });
  const nose = new THREE.Mesh(sph(.022, 8, 6), skin); nose.position.set(0, .11, .138); head.add(nose);
  // hair
  const capGeo = new THREE.SphereGeometry(.145, 20, 12, 0, TAU, 0, Math.PI * (look.style === 'buzz' ? .45 : .56));
  const cap = new THREE.Mesh(capGeo, hair); cap.position.set(0, .14, -.008); cap.rotation.x = -.22; cap.scale.set(1, 1.08, 1.04); cap.castShadow = true; head.add(cap);
  if (look.style === 'long') { const l = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .2, 4, 10), hair); l.position.set(0, .02, -.07); l.scale.set(1.12, 1, .55); l.castShadow = true; head.add(l); }
  if (look.style === 'bun') { const b = new THREE.Mesh(sph(.065), hair); b.position.set(0, .27, -.09); head.add(b); }
  if (look.style === 'curly') for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; const b = new THREE.Mesh(sph(.055, 8, 6), hair); b.position.set(Math.cos(a) * .11, .2 + Math.random() * .06, Math.sin(a) * .1 - .02); head.add(b); }
  if (look.style === 'side') { const f = new THREE.Mesh(sph(.07, 10, 8), hair); f.position.set(.06, .23, .08); f.scale.set(1.4, .6, .9); head.add(f); }
  if (look.glasses) {
    const gm = stdMat('#20262b', .4); const tg = new THREE.TorusGeometry(.03, .006, 6, 16);
    [-1, 1].forEach(s => { const t = new THREE.Mesh(tg, gm); t.position.set(s * .048, .14, .137); head.add(t); });
    const br = new THREE.Mesh(boxGeo(.03, .006, .006), gm); br.position.set(0, .145, .14); head.add(br);
  }
  if (look.headphones) {
    const hm = stdMat(look.headphones, .5);
    const band = new THREE.Mesh(new THREE.TorusGeometry(.152, .014, 6, 18, Math.PI), hm); band.position.y = .13; head.add(band);
    [-1, 1].forEach(s => { const c = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .04, 14), hm); c.rotation.z = Math.PI / 2; c.position.set(s * .145, .12, 0); head.add(c); });
  }
  const sleeve = look.longSleeve ? (look.jacket ? stdMat(look.jacket) : shirt) : skin;
  const arm = side => {
    const sh = new THREE.Group(); sh.position.set(side * .205, .46, 0); torso.add(sh);
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(.056, .17, 4, 10), look.jacket ? stdMat(look.jacket) : shirt); up.position.y = -.14; up.castShadow = true; sh.add(up);
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
  return { root, hips, torso, head, L, R, LL, RL, mug, phone, pad, putter, ring };
}

export { buildBody, ringMats };
