import * as THREE from 'three';
import { TAU } from '../core/util.js';
import { boxGeo } from '../world/helpers.js';
import { sph, stdMat, tintOf } from './gfx.js';

// Appearance parts. Each takes the head group and the CharacterSpec and adds meshes to it.
// Add a new hair style by adding an entry here and its name to STYLE_OPTIONS in spec.js.
// A style may set: cap (how much of the skull the base cap covers), none (no hair at all),
// tall (it rises above the skull, so it is drawn as plain short hair under a hat), extra (more meshes).
const HAIR_STYLES = {
  short: {},
  buzz: { cap: .45 },
  bald: { none: true },
  long: { extra: (head, hair) => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .2, 4, 10), hair); l.position.set(0, .02, -.07); l.scale.set(1.12, 1, .55); l.castShadow = true; head.add(l); } },
  bun: { tall: true, extra: (head, hair) => { const b = new THREE.Mesh(sph(.065), hair); b.position.set(0, .27, -.09); head.add(b); } },
  // curls sit at fixed, uneven heights so the look does not change every time the body is rebuilt
  curly: { tall: true, extra: (head, hair) => { for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; const b = new THREE.Mesh(sph(.055, 8, 6), hair); b.position.set(Math.cos(a) * .11, .2 + (i * 7 % 10) / 10 * .06, Math.sin(a) * .1 - .02); head.add(b); } } },
  afro: { tall: true, extra: (head, hair) => { const a = new THREE.Mesh(sph(.19, 18, 14), hair); a.position.set(0, .25, -.05); a.scale.set(1.12, 1, 1); a.castShadow = true; head.add(a); } },
  spiky: { tall: true, extra: (head, hair) => {
    const cone = new THREE.ConeGeometry(.034, .13, 5);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, c = new THREE.Mesh(cone, hair); c.position.set(Math.cos(a) * .075, .3 + (i % 2) * .02, Math.sin(a) * .075 - .01); c.rotation.set(Math.sin(a) * .5, 0, -Math.cos(a) * .5); head.add(c); }
  } },
  pigtails: { extra: (head, hair) => [-1, 1].forEach(sd => {
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(.04, .16, 4, 8), hair); t.position.set(sd * .17, .03, -.03); t.rotation.z = sd * .25; t.castShadow = true; head.add(t);
    const k = new THREE.Mesh(sph(.05, 8, 6), hair); k.position.set(sd * .15, .15, -.03); head.add(k);
  }) },
  braid: { extra: (head, hair) => { const b = new THREE.Mesh(new THREE.CapsuleGeometry(.036, .3, 4, 8), hair); b.position.set(.125, -.1, -.03); b.rotation.z = .08; b.castShadow = true; head.add(b); } },
  bob: { extra: (head, hair, spec) => {
    if (spec.cube) {
      // blocky, extra-thick bob for the cube head
      const hb = (w, h, d, x, y, z) => { const m = new THREE.Mesh(boxGeo(w, h, d), hair); m.position.set(x, y, z); m.castShadow = true; head.add(m); return m; };
      hb(.33, .09, .32, 0, .3, -.005);          // crown
      hb(.065, .27, .32, -.165, .15, -.005);    // right side, down to the jaw
      hb(.065, .27, .32, .165, .15, -.005);     // left side
      hb(.33, .29, .07, 0, .155, -.155);        // back
      hb(.29, .065, .05, 0, .235, .14);         // heavy straight fringe
    } else {
      const sideGeo = new THREE.SphereGeometry(.182, 24, 14, Math.PI / 2 + .9, TAU - 1.8, Math.PI * .22, Math.PI * .5);
      const sides = new THREE.Mesh(sideGeo, hair); sides.position.set(0, .13, -.012); sides.scale.set(1.08, 1, 1.05); sides.castShadow = true; head.add(sides);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(.172, 22, 12, 0, TAU, 0, Math.PI * .5), hair); crown.position.set(0, .14, -.01); crown.scale.set(1.06, 1.05, 1.06); crown.castShadow = true; head.add(crown);
      const fringe = new THREE.Mesh(new THREE.SphereGeometry(.168, 18, 6, Math.PI / 2 - .95, 1.9, Math.PI * .16, Math.PI * .2), hair); fringe.position.set(0, .148, .004); head.add(fringe);
    }
  } },
  side: { extra: (head, hair) => { const f = new THREE.Mesh(sph(.07, 10, 8), hair); f.position.set(.06, .23, .08); f.scale.set(1.4, .6, .9); head.add(f); } },
};

function addHair(head, spec) {
  let style = HAIR_STYLES[spec.style] || HAIR_STYLES.short;
  if (style.none) return;
  if (spec.hat && style.tall) style = HAIR_STYLES.short;
  const hair = tintOf(spec)(stdMat(spec.hair, .9));
  const capGeo = new THREE.SphereGeometry(.145, 20, 12, 0, TAU, 0, Math.PI * (style.cap ?? .56));
  const cap = new THREE.Mesh(capGeo, hair); cap.position.set(0, .14, -.008); cap.rotation.x = -.22; cap.scale.set(1, 1.08, 1.04); cap.castShadow = true; cap.visible = !spec.cube; head.add(cap);
  if (style.extra) style.extra(head, hair, spec);
}

// A furious face: brows, a frown and flushed cheeks.
function addAngry(head, spec) {
  if (!spec.angry) return;
  const bm = stdMat('#1d1714', .6);
  [-1, 1].forEach(sd => { const b = new THREE.Mesh(boxGeo(.05, .013, .012), bm); b.position.set(sd * .047, .18, .137); b.rotation.z = sd * .5; head.add(b); });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(.024, .005, 6, 12, Math.PI), stdMat('#6b2a2a', .6)); mouth.position.set(0, .075, .137); head.add(mouth);
  // flushed cheeks
  [-1, 1].forEach(sd => { const c = new THREE.Mesh(sph(.018, 8, 6), stdMat('#d9705f', .8)); c.position.set(sd * .08, .11, .132); c.scale.set(1, .6, .4); head.add(c); });
}

function addGlasses(head, spec) {
  if (!spec.glasses) return;
    const gm = stdMat('#20262b', .4); const tg = new THREE.TorusGeometry(.03, .006, 6, 16);
    [-1, 1].forEach(s => { const t = new THREE.Mesh(tg, gm); t.position.set(s * .048, .14, .137); head.add(t); });
    const br = new THREE.Mesh(boxGeo(.03, .006, .006), gm); br.position.set(0, .145, .14); head.add(br);
}

function addHeadphones(head, spec) {
  if (!spec.headphones) return;
    const hm = stdMat(spec.headphones, .5);
    const band = new THREE.Mesh(new THREE.TorusGeometry(.152, .014, 6, 18, Math.PI), hm); band.position.y = .13; head.add(band);
    [-1, 1].forEach(s => { const c = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .04, 14), hm); c.rotation.z = Math.PI / 2; c.position.set(s * .145, .12, 0); head.add(c); });
}

export { HAIR_STYLES, addAngry, addGlasses, addHair, addHeadphones };
