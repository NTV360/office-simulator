import * as THREE from 'three';
import { TAU } from '../core/util.js';
import { boxGeo } from '../world/helpers.js';
import { sph, stdMat } from './gfx.js';

// Appearance parts. Each takes the head group and the CharacterSpec and adds meshes to it.
// Add a new hair style by adding an entry here and its name to STYLE_OPTIONS in spec.js.
const HAIR_STYLES = {
  short: {},
  buzz: { cap: .45 },
  long: { extra: (head, hair) => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .2, 4, 10), hair); l.position.set(0, .02, -.07); l.scale.set(1.12, 1, .55); l.castShadow = true; head.add(l); } },
  bun: { extra: (head, hair) => { const b = new THREE.Mesh(sph(.065), hair); b.position.set(0, .27, -.09); head.add(b); } },
  curly: { extra: (head, hair) => { for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; const b = new THREE.Mesh(sph(.055, 8, 6), hair); b.position.set(Math.cos(a) * .11, .2 + Math.random() * .06, Math.sin(a) * .1 - .02); head.add(b); } } },
  side: { extra: (head, hair) => { const f = new THREE.Mesh(sph(.07, 10, 8), hair); f.position.set(.06, .23, .08); f.scale.set(1.4, .6, .9); head.add(f); } },
};

function addHair(head, spec) {
  const style = HAIR_STYLES[spec.style] || HAIR_STYLES.short, hair = stdMat(spec.hair, .9);
  const capGeo = new THREE.SphereGeometry(.145, 20, 12, 0, TAU, 0, Math.PI * (style.cap ?? .56));
  const cap = new THREE.Mesh(capGeo, hair); cap.position.set(0, .14, -.008); cap.rotation.x = -.22; cap.scale.set(1, 1.08, 1.04); cap.castShadow = true; head.add(cap);
  if (style.extra) style.extra(head, hair);
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

export { HAIR_STYLES, addGlasses, addHair, addHeadphones };
