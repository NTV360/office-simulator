// ChibiCharacter — procedural low-poly chibi characters for three.js
// --------------------------------------------------------------------
//   import * as THREE from 'three';
//   import { ChibiCharacter } from './chibi-character.js';
//   import { CHIBI_PRESETS } from './chibi-presets.js';
//
//   const c = new ChibiCharacter(THREE, { body: 'female', hair: { style: 'bob', color: '#3b2519' },
//                                         top: { style: 'hoodie', color: '#e86fa3' }, accessories: ['balloon'] });
//   scene.add(c.root);
//   c.play('Walk');            // 'Walk' | 'Idle' | 'Wave'   (riders: 'Ride' | 'Idle')
//   // every frame: c.update(delta)
//   c.set({ hair: { style: 'afro', color: '#1f1a18' } });   // rebuild in place
//
// Built in "units" (u). A character is ~21u tall; default scale 0.06 → about 1.25 world units.
// Faces +Z, feet on y = 0. Shapes are smooth, high-resolution primitives with soft shading.
// survives GLB export and any renderer.

export const SKIN_TONES = {
  porcelain: '#fbd9c8', fair: '#f2c2a8', light: '#e8b59a', peach: '#e3a785', medium: '#cf9772',
  olive: '#b9845a', tan: '#a06c48', brown: '#7e5236', dark: '#603b27', deep: '#43281a',
};
export const HAIR_COLORS = {
  black: '#1c1715', darkBrown: '#3a2418', brown: '#5b3a22', chestnut: '#7a4425', auburn: '#94381f',
  ginger: '#c4552a', blonde: '#f2c94c', platinum: '#efe4c4', grey: '#a5a5a5', white: '#f4f4f4',
  pink: '#ee7fb0', blue: '#4a86e8', teal: '#2fb5a8', purple: '#8f63dd',
};
export const EYE_COLORS = { black: '#1b1514', brown: '#5a3216', hazel: '#7a6a2e', green: '#3f8a50', blue: '#2f6fd6', grey: '#6d7b86' };
export const BUILDS = {
  skinny: { tr: 1.35, limb: 0.38, belly: 0 },
  average: { tr: 1.65, limb: 0.46, belly: 0 },
  chubby: { tr: 2.15, limb: 0.56, belly: 0.3 },
};
export const HEIGHTS = {
  short: { legL: 3.6, th: 4.3 },
  average: { legL: 4.6, th: 4.9 },
  tall: { legL: 5.9, th: 5.5 },
};
export const EYE_STYLES = ['round', 'big', 'closed', 'dots'];

export const DEFAULT_MALE = {
  name: 'Default Male', body: 'male', build: 'average', height: 'average',
  skin: SKIN_TONES.light, eyes: { style: 'round', color: EYE_COLORS.black }, cheeks: false,
  hair: { style: 'short', color: HAIR_COLORS.brown }, facialHair: { style: 'none' },
  top: { style: 'tshirt', color: '#4f86d9' }, bottom: { style: 'pants', color: '#2f3f63' },
  shoes: { style: 'simple', color: '#2b2522' }, accessories: [],
};
export const DEFAULT_FEMALE = {
  ...DEFAULT_MALE, name: 'Default Female', body: 'female', cheeks: true,
  hair: { style: 'long', color: HAIR_COLORS.brown },
};

const R = 4.3; // head radius

// ---------------------------------------------------------------- helpers
const named = (c) => SKIN_TONES[c] || HAIR_COLORS[c] || EYE_COLORS[c] || c;
function num(THREE, c, fb = 0xff00ff) { return c === undefined || c === null ? fb : typeof c === 'number' ? c : new THREE.Color(named(c)).getHex(); }
function shade(THREE, c, f) { const k = new THREE.Color(c); if (f < 1) k.multiplyScalar(f); else k.lerp(new THREE.Color(0xffffff), f - 1); return k.getHex(); }
function mixc(THREE, a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }

// ---------------------------------------------------------------- registries
// Builders receive the kit `k` (see _build) and draw with k.add(parent, geometry, color, opts).

export const HAIR_STYLES = {
  none: () => {},
  buzz: (k, c) => k.cap(k.mix(c, k.skin, 0.35), 1.025, 0.5),
  short: (k, c) => { k.cap(c); if (!k.flags.hat) k.onHead(k.G.ico(1.6, 0), c, 0.15, 0.62, 0.9, { s: [1.8, 0.7, 1] }); },
  spiky: (k, c) => {
    k.cap(c);
    if (k.flags.hat) return;
    [[-0.55, 0.55], [-0.2, 0.62], [0.2, 0.6], [0.55, 0.52], [-0.35, 0.95], [0.1, 1.0], [0.45, 0.9], [0, 1.35]].forEach(([u, v], i) =>
      k.spike(c, u, v, 0.95, 2.4 + (i % 3) * 0.5, 0.35));
  },
  swept: (k, c) => {
    k.cap(c);
    if (k.flags.hat) return;
    for (let i = 0; i < 6; i++) k.spike(i % 2 ? k.shade(c, 0.9) : c, -0.75 + i * 0.27, 0.42 + (i % 2) * 0.08, 1.0, 2.6, 0.9, { side: 0.9 });
  },
  quiff: (k, c) => { k.cap(c); if (!k.flags.hat) k.onHead(k.G.ico(2, 1), c, 0, 0.7, 1.2, { s: [1.6, 0.9, 1.1] }); },
  curly: (k, c) => {
    k.cap(c);
    if (k.flags.hat) return;
    for (let i = 0; i < 14; i++) { const u = (i / 14) * Math.PI * 2, v = 0.45 + (i % 3) * 0.3; k.onHead(k.G.ico(1.15, 0), i % 2 ? k.shade(c, 0.9) : c, u, v, 0.95); }
  },
  afro: (k, c) => {
    k.cap(c, 1.12);
    if (k.flags.hat) return;
    for (let i = 0; i < 22; i++) {
      const u = (i / 11) * Math.PI * 2 * (i < 11 ? 1 : 1) + (i >= 11 ? 0.3 : 0), v = i < 11 ? 0.35 : 0.9;
      if (i < 11 && Math.cos(u) > 0.55) continue; // keep the face clear
      k.onHead(k.G.ico(2.1, 0), i % 2 ? k.shade(c, 0.88) : c, u, v, 1.2, {});
    }
    k.onHead(k.G.ico(2.3, 0), c, 0, 1.45, 1.0);
  },
  long: (k, c) => { k.cap(c); k.bangs(c); k.locks(c, R * 2.1, 1.3, 11); },
  bob: (k, c) => { k.cap(c); k.bangs(c); k.locks(c, R * 1.15, 1.25, 11); },
  ponytail: (k, c) => {
    k.cap(c);
    k.onHead(k.G.ico(0.8, 0), k.shade(c, 0.6), Math.PI, 0.25, 0.9);
    k.add(k.headShape, k.G.cone(1.35, 5.5, 6), c, { p: [0, R * 0.05 - 1.6, -R - 1.3], r: [Math.PI - 0.35, 0, 0]});
  },
  bun: (k, c) => {
    k.cap(c); k.bangs(c);
    if (!k.flags.hat) k.onHead(k.G.ico(1.9, 1), c, Math.PI, 1.05, 1.0);
  },
  pigtails: (k, c) => {
    k.cap(c); k.bangs(c);
    for (const s of [1, -1]) {
      k.onHead(k.G.ico(0.7, 0), k.shade(c, 0.6), 1.75 * s, 0.05, 0.6);
      k.add(k.headShape, k.G.cone(1.3, 4.6, 6), c, { p: [(R + 1.2) * s, -1.6, -0.6], r: [0, 0, Math.PI + 0.35 * s]});
    }
  },
  mohawk: (k, c) => {
    k.cap(k.mix(c, k.skin, 0.7), 1.02, 0.5);
    if (k.flags.hat) return;
    for (let i = 0; i < 6; i++) k.spike(c, 0, 0.35 + i * 0.35, 0.6, 2.6 - Math.abs(i - 2.5) * 0.3, 0);
  },
};

export const FACIAL_HAIR = {
  none: () => {},
  stubble: (k, c) => k.shell(k.mix(c, k.skin, 0.55), 1.015, 0.58, 0.98, 1.5),
  moustache: (k, c) => k.moustache(c, 1),
  goatee: (k, c) => { k.moustache(c, 0.8); k.onHead(k.G.ico(1.1, 0), c, 0, -0.62, -0.1, { s: [1, 1.1, 0.8] }); },
  beard: (k, c) => { k.shell(c, 1.06, 0.55, 0.97, 1.45); k.moustache(c, 1); },
  fullBeard: (k, c) => {
    k.shell(c, 1.12, 0.5, 1, 1.55);
    k.add(k.headShape, k.G.ico(R * 0.75, 1), c, { p: [0, -R * 0.78, R * 0.42], s: [1.15, 0.95, 0.75]});
    k.moustache(c, 1.35);
  },
};

// tops: torso + sleeves ('short' | 'long' | null)
export const TOPS = {
  tshirt: (k, c) => { k.torso(c); k.sleeves(c, 'short'); k.collar(k.shade(c, 0.85)); },
  polo: (k, c, a) => { k.torso(c); k.sleeves(c, 'short'); k.collar(a ?? k.shade(c, 1.3), 1.3); },
  longsleeve: (k, c) => { k.torso(c); k.sleeves(c, 'long', k.shade(c, 0.88)); k.collar(k.shade(c, 0.85)); },
  tanktop: (k, c) => { k.torso(c); k.sleeves(c, null); },
  hoodie: (k, c, a) => {
    k.torso(c); k.sleeves(c, 'long', k.shade(c, 0.85));
    const { th, tr } = k.d;
    k.add(k.n.spine, k.G.ico(R * 0.62, 1), k.shade(c, 0.9), { p: [0, th - 0.2, -tr * 0.75], s: [1.2, 0.7, 0.7] });
    k.add(k.n.spine, k.G.box(tr * 1.2, 1.4, 0.3), k.shade(c, 0.85), { p: [0, th * 0.28, k.frontZ(th * 0.28)] });
    for (const s of [1, -1]) k.add(k.n.spine, k.G.box(0.18, 1.4, 0.18), a ?? 0xf2f2f2, { p: [0.4 * s, th * 0.72, k.frontZ(th * 0.72) + 0.05] });
  },
  jacket: (k, c, a) => {
    k.torso(c); k.sleeves(c, 'long', a ?? 0xf6f1ea);
    const { th } = k.d, acc = a ?? 0xf6f1ea;
    k.add(k.n.spine, k.G.box(0.45, th * 0.95, 0.3), acc, { p: [0, th * 0.48, k.frontZ(th * 0.45) - 0.05] });
    k.collar(acc, 1.2);
  },
  sweater: (k, c, a) => {
    k.torso(c); k.sleeves(c, 'long', k.shade(c, 0.85));
    k.band(a ?? k.shade(c, 1.35), k.d.th * 0.55, 0.9);
    k.band(k.shade(c, 0.85), 0.35, 0.7);
    k.collar(k.shade(c, 0.85), 1.2);
  },
  dress: (k, c, a) => {
    k.torso(c); k.sleeves(c, 'short');
    const { tr, legL } = k.d;
    k.add(k.n.hips, k.G.cyl(tr * 0.95, tr * 1.75, legL * 0.55, 9), c, { p: [0, -legL * 0.27 + 0.2, 0], s: [1, 1, 0.9] });
    k.band(a ?? k.shade(c, 0.75), 0.5, 0.6);
  },
};
TOPS.dress.coversLegs = true;

export const BOTTOMS = {
  bare: (k) => k.hips(k.skin),
  pants: (k, c) => { k.hips(c); k.legWear(c, 1); },
  jeans: (k, c) => { k.hips(c); k.legWear(c, 1); k.legRing(k.shade(c, 1.25), 0.97); },
  joggers: (k, c, a) => { k.hips(c); k.legWear(c, 1); k.legRing(a ?? k.shade(c, 0.75), 0.95); },
  shorts: (k, c) => { k.hips(c); k.legWear(c, 0.42); },
  skirt: (k, c) => {
    const { tr, legL } = k.d;
    k.hips(c);
    k.add(k.n.hips, k.G.cyl(tr * 1.0, tr * 1.6, legL * 0.42, 9), c, { p: [0, -legL * 0.2 + 0.2, 0], s: [1, 1, 0.9] });
  },
  leggings: (k, c) => { k.hips(c); k.legWear(c, 1, 0.07); },
};

export const SHOES = {
  bare: (k) => k.feet((leg, y) => k.add(leg, k.G.sph(k.d.limb * 1.25, 6, 4), k.skin, { p: [0, y + 0.25, 0.3], s: [1, 0.55, 1.5] })),
  simple: (k, c) => k.feet((leg, y) => k.add(leg, k.G.sph(k.d.limb * 1.55, 7, 5), c, { p: [0, y + 0.4, 0.35], s: [1, 0.6, 1.45] })),
  sneakers: (k, c, a) => k.feet((leg, y) => {
    const r = k.d.limb * 1.6;
    k.add(leg, k.G.sph(r, 7, 5), c, { p: [0, y + 0.5, 0.35], s: [1, 0.62, 1.45] });
    k.add(leg, k.G.cyl(r * 1.02, r * 1.02, 0.32, 8), a ?? 0xf7f4ee, { p: [0, y + 0.16, 0.35], s: [1, 1, 1.45] });
    k.add(leg, k.G.box(r * 0.8, 0.15, 0.7), a ?? 0xf7f4ee, { p: [0, y + r * 0.62 + 0.45, 0.55], r: [-0.4, 0, 0] });
  }),
  boots: (k, c) => k.feet((leg, y) => {
    const r = k.d.limb * 1.6;
    k.add(leg, k.G.cyl(k.d.limb * 1.35, k.d.limb * 1.45, 1.9, 7), c, { p: [0, y + 1.0, 0] });
    k.add(leg, k.G.sph(r, 7, 5), c, { p: [0, y + 0.45, 0.4], s: [1, 0.6, 1.45] });
    k.add(leg, k.G.cyl(r * 1.02, r * 1.02, 0.3, 8), k.shade(c, 0.55), { p: [0, y + 0.15, 0.4], s: [1, 1, 1.45] });
  }),
};

// accessories — slot: head | face | body | back | hand | ride
export const ACCESSORIES = {
  cap: { slot: 'head', hat: true, color: '#d64545', build: (k, c) => {
    k.add(k.headShape, k.G.sph(R * 1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), c, { r: [-0.25, 0, 0], double: true });
    k.add(k.headShape, k.G.cyl(R * 1.05, R * 1.1, 0.3, 10, -Math.PI * 0.32, Math.PI * 0.64), k.shade(c, 0.82), { p: [0, R * 0.42, 0], s: [1, 1, 1.45], r: [0.12, 0, 0] });
    k.add(k.headShape, k.G.ico(0.45, 0), k.shade(c, 0.82), { p: [0, R * 1.08, -R * 0.27] });
  } },
  beanie: { slot: 'head', hat: true, color: '#2fb5a8', build: (k, c, a) => {
    k.add(k.headShape, k.G.sph(R * 1.13, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), c, { r: [-0.15, 0, 0], double: true });
    k.add(k.headShape, k.G.cyl(R * 1.16, R * 1.16, 1.4, 10, 0, Math.PI * 2, true), k.shade(c, 0.82), { p: [0, R * 0.07, -R * 0.15], r: [-0.15, 0, 0], double: true });
    k.add(k.headShape, k.G.ico(1.1, 1), a ?? 0xf5f0e6, { p: [0, R * 1.12, -R * 0.15] });
  } },
  santaHat: { slot: 'head', hat: true, color: '#c8262f', build: (k, c, a) => {
    const hat = k.joint(k.headShape, 'Hat', 0, R * 0.55, -R * 0.1);
    hat.rotation.set(-0.25, 0, 0.35);
    k.add(hat, k.G.cone(R * 1.1, R * 1.9, 9), c, { p: [0, R * 0.95, 0]});
    k.add(hat, k.G.torus(R * 1.05, 0.75, 6, 12), a ?? 0xf8f6f2, { r: [Math.PI / 2, 0, 0] });
    k.add(hat, k.G.ico(1.0, 1), a ?? 0xf8f6f2, { p: [0, R * 1.95, 0] });
  } },
  headphones: { slot: 'head', color: '#2a2d34', build: (k, c, a) => {
    const lift = k.flags.hat ? 1.18 : k.flags.tallHair ? 1.22 : 1.1;
    k.add(k.headShape, k.G.torus(R * lift, 0.35, 5, 14, Math.PI), c, { p: [0, 0, 0] });
    for (const s of [1, -1]) k.add(k.headShape, k.G.cyl(1.25, 1.25, 0.9, 8), a ?? 0xe25563, { p: [R * 1.05 * s, 0, 0], r: [0, 0, Math.PI / 2] });
  } },
  glasses: { slot: 'face', color: '#2a2320', build: (k, c) => {
    for (const s of [1, -1]) k.onHead(k.G.torus(0.95, 0.14, 4, 10), c, 0.38 * s, 0.0, 0.55);
    k.onHead(k.G.box(0.8, 0.14, 0.14), c, 0, 0.08, 0.7);
    for (const s of [1, -1]) k.add(k.headShape, k.G.box(0.14, 0.14, R * 0.75), c, { p: [R * 0.93 * s, 0.05, R * 0.18] });
  } },
  sunglasses: { slot: 'face', color: '#15161b', build: (k, c) => {
    for (const s of [1, -1]) k.onHead(k.G.cyl(1.05, 1.05, 0.2, 8), c, 0.38 * s, 0.0, 0.55, { r: [Math.PI / 2, 0, 0], s: [1.1, 1, 0.85] });
    k.onHead(k.G.box(1.0, 0.22, 0.2), c, 0, 0.06, 0.7);
    for (const s of [1, -1]) k.add(k.headShape, k.G.box(0.14, 0.18, R * 0.75), c, { p: [R * 0.93 * s, 0.05, R * 0.18] });
  } },
  earrings: { slot: 'face', color: '#e8c25a', build: (k, c) => { for (const s of [1, -1]) k.onHead(k.G.ico(0.38, 0), c, 1.5 * s, -0.4, 0.15); } },
  scarf: { slot: 'body', color: '#c9473f', build: (k, c, a) => {
    const { th, tr } = k.d;
    k.add(k.n.spine, k.G.torus(tr * 0.75, 0.7, 6, 10), c, { p: [0, th - 0.1, 0.05], r: [Math.PI / 2, 0, 0], s: [1, 0.85, 1] });
    k.add(k.n.spine, k.G.box(1.0, th * 0.55, 0.4), c, { p: [tr * 0.35, th * 0.65, k.frontZ(th * 0.65) + 0.25], r: [0.1, 0, 0.08] });
    k.add(k.n.spine, k.G.box(1.05, 0.35, 0.45), a ?? 0xf5f0e6, { p: [tr * 0.38, th * 0.45, k.frontZ(th * 0.45) + 0.28], r: [0.1, 0, 0.08] });
  } },
  tie: { slot: 'body', color: '#2f3d6e', build: (k, c) => {
    const { th } = k.d;
    k.add(k.n.spine, k.G.ico(0.38, 0), c, { p: [0, th - 0.55, k.frontZ(th - 0.55) + 0.1] });
    k.add(k.n.spine, k.G.box(0.55, th * 0.55, 0.15), c, { p: [0, th * 0.58, k.frontZ(th * 0.58) + 0.08] });
  } },
  bowtie: { slot: 'body', color: '#c8262f', build: (k, c) => {
    const y = k.d.th - 0.5, z = k.frontZ(y) + 0.2;
    for (const s of [1, -1]) k.add(k.n.spine, k.G.cone(0.45, 0.9, 4), c, { p: [0.45 * s, y, z], r: [0, 0, (Math.PI / 2) * s] });
    k.add(k.n.spine, k.G.ico(0.25, 0), k.shade(c, 0.8), { p: [0, y, z + 0.05] });
  } },
  belt: { slot: 'body', color: '#1d1a19', build: (k, c, a) => {
    const r = k.torsoR(0.75) * 1.05;
    k.add(k.n.spine, k.G.cyl(r, r, 0.55, 9), c, { p: [0, 0.75, 0], s: [1, 1, k.d.depth] });
    k.add(k.n.spine, k.G.box(0.9, 0.7, 0.2), a ?? 0xe8c25a, { p: [0, 0.75, r * k.d.depth + 0.05] });
  } },
  gloves: { slot: 'body', color: '#1d1a19', build: (k, c) => {
    for (const h of [k.n.handL, k.n.handR]) k.add(h, k.G.ico(k.d.limb * 1.5, 0), c);
  } },
  watch: { slot: 'body', color: '#1d2633', build: (k, c) => {
    const arm = k.flags.handL ? k.n.armR : k.n.armL;
    k.add(arm, k.G.cyl(k.d.limb * 1.2, k.d.limb * 1.2, 0.35, 7), c, { p: [0, -k.d.armLen + 0.9, 0] });
    k.add(arm, k.G.box(0.15, 0.5, 0.5), 0x9fb4c8, { p: [k.d.limb * 1.2 * (arm === k.n.armL ? 1 : -1), -k.d.armLen + 0.9, 0] });
  } },
  backpack: { slot: 'back', color: '#3f7a5a', build: (k, c) => {
    const { th, tr } = k.d;
    k.add(k.n.spine, k.G.box(tr * 1.5, th * 0.75, 1.6), c, { p: [0, th * 0.55, -tr * 0.82 - 0.8]});
    k.add(k.n.spine, k.G.box(tr * 1.0, th * 0.25, 0.5), k.shade(c, 0.8), { p: [0, th * 0.35, -tr * 0.82 - 1.75] });
    for (const s of [1, -1]) k.add(k.n.spine, k.G.box(0.35, th * 0.75, 0.15), k.shade(c, 0.7), { p: [tr * 0.45 * s, th * 0.55, k.frontZ(th * 0.55) + 0.05] });
  } },
  // hand items: sit against the round hand (never through it); arms pose while holding
  briefcase: { slot: 'hand', hand: 'R', swing: 0.3, color: '#5a2a1e', build: (k, c, a, h) => {
    const r = k.d.limb * 1.35;
    k.add(h, k.G.torus(0.55, 0.13, 4, 8, Math.PI), k.shade(c, 0.6), { p: [0, -r * 0.6, 0], r: [0, Math.PI / 2, Math.PI] });
    k.add(h, k.G.box(1.1, 2.4, 3.6), c, { p: [0, -r - 1.4, 0]});
    k.add(h, k.G.box(1.2, 0.3, 0.6), 0xe8c25a, { p: [0, -r - 0.5, 0] });
  } },
  book: { slot: 'hand', hand: 'L', swing: 0.4, color: '#3a6ea5', build: (k, c, a, h, s) => {
    const r = k.d.limb * 1.35, x = (r + 0.3) * s;
    k.add(h, k.G.box(0.65, 3.0, 2.3), c, { p: [x, -0.4, 0.2] });
    k.add(h, k.G.box(0.5, 2.8, 2.15), 0xf7f2e6, { p: [x + 0.1 * s, -0.4, 0.3] });
  } },
  phone: { slot: 'hand', hand: 'R', pose: { x: -1.05, z: 0.25 }, upright: 0.9, color: '#3d7bf2', build: (k, c, a, h) => {
    const r = k.d.limb * 1.35;
    k.add(h, k.G.box(1.5, 2.6, 0.3), c, { p: [0, r + 0.7, 0.15] });
    k.add(h, k.G.box(1.3, 2.3, 0.05), a ?? 0x8fe0ff, { p: [0, r + 0.75, -0.02], emissive: 0.8 });
  } },
  coffee: { slot: 'hand', hand: 'L', pose: { x: -0.8, z: 0.1 }, upright: 1, color: '#f7f2ea', build: (k, c, a, h, s) => {
    const r = k.d.limb * 1.35, x = -(r + 0.55) * s;
    k.add(h, k.G.cyl(0.75, 0.6, 1.9, 8), c, { p: [x, 0.35, 0] });
    k.add(h, k.G.cyl(0.82, 0.82, 0.35, 8), 0x3b2a20, { p: [x, 1.45, 0] });
    k.add(h, k.G.cyl(0.74, 0.68, 0.75, 8), a ?? 0xd9653b, { p: [x, 0.3, 0] });
  } },
  tablet: { slot: 'hand', hand: 'both', pose: { x: -0.95, z: 0.12 }, upright: 0.75, color: '#e8ecf2', build: (k, c, a, h, s) => {
    const hx = k.d.sx - (k.d.armLen) * 0.12, x = -hx * s, r = k.d.limb * 1.35;
    k.add(h, k.G.box(hx * 2 + 1.4, 3.4, 0.3), c, { p: [x, r + 1.2, r * 0.6] });
    k.add(h, k.G.box(hx * 2 + 0.9, 2.9, 0.05), a ?? 0x8fe0ff, { p: [x, r + 1.2, r * 0.6 - 0.17], emissive: 0.7 });
  } },
  icecream: { slot: 'hand', hand: 'L', pose: { x: -0.7, z: -0.45 }, upright: 1, color: '#f4a7c4', build: (k, c, a, h) => {
    const r = k.d.limb * 1.35;
    k.add(h, k.G.cone(0.85, 2.6, 6), 0xd9a35a, { p: [0, r + 0.75, 0.6], r: [Math.PI, 0, 0] });
    k.add(h, k.G.ico(1.15, 1), c, { p: [0, r + 2.4, 0.6] });
    k.add(h, k.G.ico(0.38, 0), 0xc8262f, { p: [0, r + 3.6, 0.6] });
  } },
  balloon: { slot: 'hand', hand: 'L', pose: { x: -0.25, z: -0.55 }, upright: 1, color: '#e2453b', build: (k, c, a, h, s) => {
    const lean = 0.42 * s, L = 11;                        // string leans away from the head
    k.add(h, k.G.cyl(0.05, 0.05, L, 3), 0xdddddd, { p: [Math.sin(lean) * L / 2, Math.cos(lean) * L / 2, 0], r: [0, 0, -lean] });
    const tx = Math.sin(lean) * L, ty = Math.cos(lean) * L;
    k.add(h, k.G.cone(0.35, 0.5, 5), c, { p: [tx, ty + 0.1, 0], r: [Math.PI, 0, 0] });
    k.add(h, k.G.ico(2.2, 1), c, { p: [tx, ty + 2.6, 0], s: [1, 1.15, 1]});
  } },
  skateboard: { slot: 'ride', color: '#d9653b', build: (k, c, a) => {
    const b = k.n.board;
    k.add(b, k.G.box(3.2, 0.35, 10), c, { p: [0, 1.55, 0] });
    k.add(b, k.G.box(3.0, 0.08, 9.6), 0x2a2a2e, { p: [0, 1.75, 0] });
    for (const s of [1, -1]) {
      k.add(b, k.G.box(3.2, 0.35, 1.6), c, { p: [0, 1.8, 5.6 * s], r: [-0.4 * s, 0, 0] });
      k.add(b, k.G.box(2.2, 0.4, 0.7), 0x9aa0a8, { p: [0, 1.15, 3.4 * s] });
      for (const x of [1.4, -1.4]) k.add(b, k.G.cyl(0.5, 0.5, 0.55, 7), a ?? 0xf2efe6, { p: [x, 0.5, 3.4 * s], r: [0, 0, Math.PI / 2] });
    }
    return 1.8;
  } },
  hoverboard: { slot: 'ride', hover: true, color: '#e8ecf2', build: (k, c, a) => {
    const b = k.n.board;
    k.add(b, k.G.cyl(2.2, 2.0, 0.7, 8), c, { p: [0, 2.0, 0], s: [1, 1, 2.3] });
    k.add(b, k.G.cyl(1.6, 1.6, 0.2, 8), a ?? 0x37d6ff, { p: [0, 1.55, 0], s: [1, 1, 2.3], emissive: 1.2 });
    return 2.35;
  } },
};

// ---------------------------------------------------------------- class
export class ChibiCharacter {
  constructor(THREE, config = {}, { scale = 0.06 } = {}) {
    this.THREE = THREE;
    this.scale = scale;
    this.root = new THREE.Group();
    this.root.name = 'ChibiCharacter';
    this.mixer = new THREE.AnimationMixer(this.root);
    this.current = null;
    this.set(config, true);
  }

  static normalize(config = {}) {
    const base = config.body === 'female' ? DEFAULT_FEMALE : DEFAULT_MALE;
    const part = (v, def) => (typeof v === 'string' ? { ...def, style: v } : { ...def, ...(v || {}) });
    return {
      ...base, ...config,
      eyes: typeof config.eyes === 'string' && !EYE_STYLES.includes(config.eyes) ? { ...base.eyes, color: config.eyes } : part(config.eyes, base.eyes),
      hair: part(config.hair, base.hair),
      facialHair: part(config.facialHair, base.facialHair),
      top: part(config.top, base.top),
      bottom: part(config.bottom, base.bottom),
      shoes: part(config.shoes, base.shoes),
      accessories: (config.accessories ?? base.accessories).map((a) => (typeof a === 'string' ? { type: a } : { ...a })),
    };
  }

  set(patch = {}, replace = false) {
    this.config = ChibiCharacter.normalize(replace ? patch : { ...(this.config ?? {}), ...patch });
    const playing = this.current?.getClip().name;
    this._clear();
    this._build();
    this.play(playing && this.clipNames.includes(playing) ? playing : this.defaultClip, 0);
    return this;
  }
  toJSON() { return JSON.parse(JSON.stringify(this.config)); }
  get clipNames() { return this.clips.map((c) => c.name); }
  play(name = this.defaultClip, fade = 0.25) {
    const clip = this.clips.find((c) => c.name === name);
    if (!clip) return this;
    const next = this.mixer.clipAction(clip);
    if (this.current === next) return this;
    next.reset().play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
    return this;
  }
  update(dt) { this.mixer.update(dt); }
  dispose() { this._clear(); }

  _clear() {
    this.mixer.stopAllAction();
    this.current = null;
    (this.clips || []).forEach((c) => this.mixer.uncacheClip(c));
    this.mixer.uncacheRoot(this.root);
    for (const ch of [...this.root.children]) this.root.remove(ch);
    (this._geoms || []).forEach((g) => g.dispose());
    (this._mats ? [...this._mats.values()] : []).forEach((m) => m.dispose());
    this._geoms = []; this._mats = new Map();
  }

  _build() {
    const THREE = this.THREE, cfg = this.config;
    const female = cfg.body === 'female';
    const B = BUILDS[cfg.build] ?? BUILDS.average, H = HEIGHTS[cfg.height] ?? HEIGHTS.average;
    const tr = B.tr * (female ? 0.92 : 1), limb = B.limb * (female ? 0.9 : 1);
    const d = { ...B, ...H, tr, limb, armLen: H.th * 0.82 + 0.3, depth: 0.82 };
    d.sx = tr * 0.92 + limb * 0.7;
    const C = (c, fb) => num(THREE, c, fb);
    const skin = C(cfg.skin);

    // geometry factory (all in units)
    // primitives are authored at low counts and scaled up here for smooth, rounded shapes
    const up = (n, f, min) => Math.max(min, Math.round(n * f));
    const G = {
      ico: (r, det = 1) => new THREE.SphereGeometry(r, det ? 26 : 18, det ? 18 : 12),
      sph: (r, w = 8, h = 6, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, up(w, 3, 20), up(h, 3, 12), ps, pl, ts, tl),
      cyl: (rt, rb, h, seg = 7, ts = 0, tl = Math.PI * 2, open = false) => new THREE.CylinderGeometry(rt, rb, h, up(seg, 3, 18), 1, open, ts, tl),
      cone: (r, h, seg = 6) => new THREE.ConeGeometry(r, h, up(seg, 3, 14)),
      box: (w, h, dd) => new THREE.BoxGeometry(w, h, dd),
      torus: (r, t, rs = 5, ts = 10, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, up(rs, 2.5, 10), up(ts, 3, 28), arc),
      lathe: (pts, seg = 8) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), up(seg, 3, 24)),
    };
    const mat = (color, o = {}) => {
      const key = `${color}|${o.double ? 1 : 0}|${o.emissive ?? 0}`;
      if (!this._mats.has(key)) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, side: o.double ? THREE.DoubleSide : THREE.FrontSide });
        if (o.emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = o.emissive; }
        this._mats.set(key, m);
      }
      return this._mats.get(key);
    };
    const finish = (geo) => {
      if (!geo.attributes.normal) geo.computeVertexNormals();
      this._geoms.push(geo);
      return geo;
    };
    const add = (parent, geo, color, o = {}) => {
      const m = new THREE.Mesh(finish(geo), mat(color, o));
      if (o.p) m.position.set(...o.p);
      if (o.r) m.rotation.set(...o.r);
      if (o.s) typeof o.s === 'number' ? m.scale.setScalar(o.s) : m.scale.set(...o.s);
      if (o.q) m.quaternion.premultiply(o.q);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const joint = (parent, name, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g;
    };

    // accessories → slots
    const acc = cfg.accessories.map((a) => ({ ...a, def: ACCESSORIES[a.type] })).filter((a) => a.def);
    const hands = {}, warnings = [];
    let ride = null;
    for (const a of acc) {
      if (a.def.slot === 'hand') for (const h of a.def.hand === 'both' ? ['L', 'R'] : [a.side ?? a.def.hand]) {
        if (hands[h]) warnings.push(`${a.type} replaced ${hands[h].type} in the ${h === 'L' ? 'left' : 'right'} hand`);
        hands[h] = a;
      }
      if (a.def.slot === 'ride') { if (ride) warnings.push(`${a.type} replaced ${ride.type}`); ride = a; }
    }
    this.warnings = warnings;
    const flags = {
      hat: acc.some((a) => a.def.hat),
      tallHair: ['spiky', 'quiff', 'afro', 'bun', 'mohawk', 'curly'].includes(cfg.hair.style),
      handL: !!hands.L, handR: !!hands.R,
    };

    // skeleton (rig is scaled; everything inside is in units)
    const n = {};
    n.rig = joint(this.root, 'Rig'); n.rig.scale.setScalar(this.scale);
    n.ride = joint(n.rig, 'Ride');
    n.board = joint(n.ride, 'Board');
    n.body = joint(n.ride, 'Body');
    n.hips = joint(n.body, 'Hips', 0, d.legL, 0);
    const legX = tr * 0.48;
    n.legL = joint(n.hips, 'LegL', legX, 0, 0);
    n.legR = joint(n.hips, 'LegR', -legX, 0, 0);
    n.spine = joint(n.hips, 'Spine', 0, 0.4, 0);
    n.neck = joint(n.spine, 'Neck', 0, d.th, 0);
    n.armL = joint(n.spine, 'ArmL', d.sx, d.th - 0.75, 0);
    n.armR = joint(n.spine, 'ArmR', -d.sx, d.th - 0.75, 0);
    n.handL = joint(n.armL, 'HandL', 0, -d.armLen, 0);
    n.handR = joint(n.armR, 'HandR', 0, -d.armLen, 0);
    const headShape = joint(n.neck, 'HeadShape', 0, R * 0.8, 0.15);
    headShape.scale.set(1, 0.95, 0.93);

    // torso profile radius at height y (spine space), used to place things on the chest
    const ctrl = [[tr * 1.02, -0.2], [tr * (1 + B.belly), d.th * 0.4], [tr * 0.95, d.th * 0.8], [tr * 0.55, d.th]];
    // a curved outline through the control points (no ridge at the belly)
    const prof = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(16).map((v) => [v.x, v.y]);
    const torsoR = (y) => {
      for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) {
        const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
      return prof[prof.length - 1][0];
    };
    const dirOf = (u, v) => new THREE.Vector3(Math.sin(u) * Math.cos(v), Math.sin(v), Math.cos(u) * Math.cos(v));

    const k = {
      THREE, G, n, d, cfg, flags, skin, headShape, add, joint,
      shade: (c, f) => shade(THREE, c, f), mix: (a, b, t) => mixc(THREE, a, b, t),
      has: (t) => acc.some((a) => a.type === t),
      frontZ: (y) => torsoR(y) * d.depth,
      torsoR,
      // place geometry on the head surface at angles u (around, + = character's left) and v (up), pushed out by `out`
      onHead(geo, color, u, v, out = 0, o = {}) {
        const dir = dirOf(u, v);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, o.up ? 1 : 0, o.up ? 0 : 1), dir);
        if (o.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o.tilt));
        const m = add(headShape, geo, color, { ...o, p: dir.multiplyScalar(R + out).toArray(), r: undefined, q });
        if (o.r) { const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.r)); m.quaternion.multiply(e); }
        return m;
      },
      spike(color, u, v, out, len, lean = 0.3, o = {}) {
        const m = k.onHead(G.cone(0.85, len, 4), color, u, v, out + len * 0.3, { up: true});
        m.rotateX(-lean * 0.4); if (o.side) m.rotateZ(-o.side * 0.6);
        return m;
      },
      cap(color, scale = 1.07, theta = 0.5) {
        if (flags.hat) scale = Math.min(scale, 1.035);
        add(headShape, G.sph(R * scale, 10, 7, 0, Math.PI * 2, 0, Math.PI * theta), color, { r: [-0.38, 0, 0], double: true});
      },
      bangs(color) {
        add(headShape, G.sph(R * (flags.hat ? 1.04 : 1.09), 8, 3, Math.PI / 2 - 0.85, 1.7, Math.PI * 0.2, Math.PI * 0.2), color, { double: true});
      },
      // chunky hanging locks around the sides and back (u from +uMin around the back to -uMin)
      locks(color, len, uMin, count) {
        for (let i = 0; i < count; i++) {
          const u = uMin + ((Math.PI * 2 - 2 * uMin) * i) / (count - 1);
          const r = R * 0.9 + 0.45, x = Math.sin(u) * r, z = Math.cos(u) * r;
          add(headShape, G.ico(1.5, 0), i % 2 ? k.shade(color, 0.9) : color,
            { p: [x, R * 0.3 - len / 2, z], s: [0.95, len / 3.0, 0.8], r: [0, u, 0]});
        }
      },
      shell(color, scale, t0, t1, phiLen) {
        add(headShape, G.sph(R * scale, 10, 6, Math.PI / 2 - (phiLen * Math.PI) / 2, phiLen * Math.PI, Math.PI * t0, Math.PI * (t1 - t0)), color, { double: true});
      },
      moustache(color, size) {
        for (const s of [1, -1]) k.onHead(G.ico(0.75 * size, 0), color, 0.2 * s, -0.27, 0.15 * size, { s: [1.5, 0.6, 0.8], r: [0, 0, -0.35 * s] });
      },
      torso(color) {
        add(n.spine, G.lathe([[0, -0.2], ...prof, [0, d.th]], 8), color, { s: [1, 1, d.depth] });
      },
      sleeves(color, len, cuff) {
        for (const arm of [n.armL, n.armR]) {
          add(arm, G.ico(limb * 1.45, 0), len ? color : skin, { p: [0, 0.1, 0] });
          if (!len) continue;
          const L = len === 'long' ? d.armLen - limb * 1.2 : d.armLen * 0.4;
          add(arm, G.cyl(limb * 1.32, limb * 1.25, L, 7), color, { p: [0, -L / 2 + 0.1, 0] });
          if (len === 'long') add(arm, G.cyl(limb * 1.42, limb * 1.42, 0.45, 7), cuff ?? color, { p: [0, -L + 0.3, 0] });
        }
      },
      collar(color, size = 1) {
        add(n.spine, G.torus(tr * 0.5, 0.2 * size, 4, 9), color, { p: [0, d.th - 0.05, 0], r: [Math.PI / 2, 0, 0], s: [1, d.depth * 1.05, 1] });
      },
      band(color, y, h) {
        add(n.spine, G.cyl(torsoR(y + h / 2) * 1.04, torsoR(y - h / 2) * 1.04, h, 8), color, { p: [0, y, 0], s: [1, 1, d.depth] });
      },
      hips(color) {
        add(n.hips, G.lathe([[0, -0.8], [tr * 0.9, -0.8], [tr * 0.93, 0.15], [tr * 0.8, 1.1], [0, 1.1]], 8), color, { s: [1, 1, d.depth * 0.97] });
      },
      legWear(color, frac, extra = 0.14) {
        const L = (d.legL - 0.9) * frac;
        for (const leg of [n.legL, n.legR]) add(leg, G.cyl(limb * 1.18 + extra, limb * 1.05 + extra, L + 0.2, 7), color, { p: [0, -L / 2 + 0.1, 0] });
      },
      legRing(color, frac) {
        const y = -(d.legL - 0.9) * frac;
        for (const leg of [n.legL, n.legR]) add(leg, G.cyl(limb * 1.3, limb * 1.3, 0.4, 7), color, { p: [0, y + 0.2, 0] });
      },
      feet(fn) { fn(n.legL, -d.legL); fn(n.legR, -d.legL); },
    };

    // base body (skin)
    for (const leg of [n.legL, n.legR]) add(leg, G.cyl(limb * 1.1, limb, d.legL - 0.5, 7), skin, { p: [0, -(d.legL - 0.5) / 2, 0] });
    for (const arm of [n.armL, n.armR]) add(arm, G.cyl(limb, limb * 0.92, d.armLen, 7), skin, { p: [0, -d.armLen / 2, 0] });
    for (const h of [n.handL, n.handR]) add(h, G.ico(limb * 1.35, 0), skin, {});
    add(n.neck, G.cyl(limb * 1.6, limb * 1.8, 1.2, 7), skin, { p: [0, 0.3, 0] });
    add(headShape, G.ico(R, 1), skin, {});

    // face
    const eyeC = C(cfg.eyes.color), dark = 0x2a1a16;
    for (const s of [1, -1]) {
      const style = cfg.eyes.style;
      if (style === 'closed') k.onHead(G.box(0.95, 0.2, 0.25), dark, 0.36 * s, -0.02, -0.05, { r: [0, 0, 0.18 * s] });
      else if (style === 'dots') k.onHead(G.sph(0.32, 6, 4), dark, 0.34 * s, 0, -0.08);
      else if (style === 'big') {
        k.onHead(G.sph(0.85, 7, 5), 0xfbf7f2, 0.37 * s, -0.02, -0.3, { s: [0.9, 1.1, 0.5] });
        k.onHead(G.sph(0.6, 7, 5), eyeC, 0.37 * s, -0.03, -0.1, { s: [0.9, 1.1, 0.5] });
        k.onHead(G.sph(0.18, 4, 3), 0xffffff, 0.34 * s, 0.05, 0.12);
      } else {
        k.onHead(G.sph(0.55, 7, 5), eyeC, 0.36 * s, -0.02, -0.12, { s: [0.85, 1.1, 0.5] });
        k.onHead(G.sph(0.15, 4, 3), 0xffffff, 0.33 * s, 0.05, 0.05);
      }
      const browC = cfg.hair.style === 'none' ? shade(THREE, skin, 0.55) : shade(THREE, C(cfg.hair.color), 0.85);
      k.onHead(G.box(1.05, 0.26, 0.25), browC, 0.38 * s, 0.27, -0.02, { r: [0, 0, -0.12 * s] });
      if (female && style !== 'closed') k.onHead(G.box(0.45, 0.16, 0.2), dark, 0.56 * s, 0.1, -0.02, { r: [0, 0, 0.6 * s] });
      if (cfg.cheeks) k.onHead(G.sph(0.6, 6, 4), mixc(THREE, skin, 0xe86f8a, 0.55), 0.62 * s, -0.17, -0.12, { s: [1.2, 0.7, 0.3] });
      k.onHead(G.ico(1, 0), shade(THREE, skin, 0.9), (Math.PI / 2) * 0.98 * s, -0.02, -0.25, { s: [0.45, 0.95, 0.75] });
    }
    const noseC = mixc(THREE, skin, 0xd0505a, 0.3);
    k.onHead(G.sph(0.62, 8, 6), noseC, 0, -0.1, 0.05, { s: [1, 0.85, 0.9] });
    const fh = cfg.facialHair.style;
    const mouthOut = fh === 'fullBeard' ? 0.6 : fh === 'beard' ? 0.3 : 0;
    if (fh !== 'goatee') k.onHead(G.box(fh === 'none' ? 0.9 : 1.1, 0.18, 0.25), female ? C(cfg.lips ?? '#b8505e') : 0x6b2e2a, 0, -0.36, mouthOut - 0.03);

    // clothes
    const topFn = TOPS[cfg.top.style] ?? TOPS.tshirt;
    const acol = (p) => (p.accent !== undefined ? C(p.accent) : undefined);
    topFn(k, C(cfg.top.color), acol(cfg.top));
    let bottom = cfg.bottom.style;
    if (topFn.coversLegs && !['leggings', 'bare'].includes(bottom)) bottom = 'bare';
    (BOTTOMS[bottom] ?? BOTTOMS.pants)(k, C(cfg.bottom.color), acol(cfg.bottom));
    (SHOES[cfg.shoes.style] ?? SHOES.simple)(k, C(cfg.shoes.color), acol(cfg.shoes));

    // hair
    (HAIR_STYLES[cfg.hair.style] ?? HAIR_STYLES.short)(k, C(cfg.hair.color));
    (FACIAL_HAIR[fh] ?? FACIAL_HAIR.none)(k, C(cfg.facialHair.color ?? cfg.hair.color));

    // accessories
    const itemNodes = {};
    let boardTop = 0;
    for (const a of acc) {
      const c = C(a.color ?? a.def.color), ac = a.accent !== undefined ? C(a.accent) : undefined;
      if (a.def.slot === 'hand') {
        for (const h of a.def.hand === 'both' ? ['L'] : [a.side ?? a.def.hand]) {
          if (hands[h] !== a) continue;
          const item = joint(n['hand' + h], 'Item' + h);
          const sgn = h === 'L' ? 1 : -1;
          if (a.def.upright) item.rotation.set(-(a.def.pose?.x ?? 0) * a.def.upright, 0, (a.def.pose?.z ?? 0) * sgn);
          itemNodes[h] = item;
          a.def.build(k, c, ac, item, sgn);
        }
      } else if (a.def.slot === 'ride') { if (ride === a) boardTop = a.def.build(k, c, ac) ?? 0; }
      else a.def.build(k, c, ac);
    }
    if (ride) { n.body.position.y = boardTop; n.body.rotation.y = 1.35; }

    const rig = { d, hands, ride, itemNodes };
    this.clips = ride ? [rideClip(THREE, rig, true), rideClip(THREE, rig, false)] : [walkClip(THREE, rig), idleClip(THREE, rig), waveClip(THREE, rig)];
    this.defaultClip = this.clips[0].name;
  }

  static registerAccessory(name, def) { ACCESSORIES[name] = def; }
  static registerHair(name, fn) { HAIR_STYLES[name] = fn; }
  static registerFacialHair(name, fn) { FACIAL_HAIR[name] = fn; }
  static registerTop(name, fn) { TOPS[name] = fn; }
  static registerBottom(name, fn) { BOTTOMS[name] = fn; }
  static registerShoes(name, fn) { SHOES[name] = fn; }
  static get options() {
    return {
      body: ['male', 'female'], build: Object.keys(BUILDS), height: Object.keys(HEIGHTS), eyes: EYE_STYLES,
      hair: Object.keys(HAIR_STYLES), facialHair: Object.keys(FACIAL_HAIR), top: Object.keys(TOPS),
      bottom: Object.keys(BOTTOMS), shoes: Object.keys(SHOES), accessories: Object.keys(ACCESSORIES),
    };
  }
  static random(seed = Math.random() * 1e9) {
    let s = Math.floor(seed) || 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const body = pick(['male', 'female']);
    const colors = ['#4f86d9', '#d64545', '#3fae6c', '#f2b43c', '#8f63dd', '#2d2d33', '#f2ece2', '#ee7fb0', '#2fb5a8', '#c8262f', '#e86f3a'];
    const acc = [];
    if (r() < 0.35) acc.push(pick(['cap', 'beanie', 'headphones', 'santaHat']));
    if (r() < 0.3) acc.push(pick(['glasses', 'sunglasses']));
    if (r() < 0.35) acc.push(pick(['backpack', 'scarf', 'watch', 'bowtie', 'belt']));
    if (r() < 0.45) acc.push(pick(['phone', 'coffee', 'book', 'tablet', 'briefcase', 'icecream', 'balloon']));
    if (r() < 0.1) acc.push(pick(['skateboard', 'hoverboard']));
    return {
      name: 'Random', body,
      build: pick(['skinny', 'average', 'average', 'chubby']), height: pick(['short', 'average', 'average', 'tall']),
      skin: pick(Object.values(SKIN_TONES)), cheeks: body === 'female' ? r() < 0.8 : r() < 0.2,
      eyes: { style: pick(['round', 'round', 'big', 'closed', 'dots']), color: pick(Object.values(EYE_COLORS)) },
      hair: { style: pick(body === 'female' ? ['long', 'bob', 'ponytail', 'bun', 'pigtails', 'curly', 'afro'] : ['short', 'spiky', 'swept', 'quiff', 'buzz', 'curly', 'afro', 'none', 'mohawk']), color: pick(Object.values(HAIR_COLORS).slice(0, r() < 0.15 ? 14 : 10)) },
      facialHair: { style: body === 'male' ? pick(['none', 'none', 'stubble', 'moustache', 'goatee', 'beard', 'fullBeard']) : 'none' },
      top: { style: pick(Object.keys(TOPS).filter((t) => body === 'female' || t !== 'dress')), color: pick(colors) },
      bottom: { style: pick(['pants', 'jeans', 'joggers', 'shorts', ...(body === 'female' ? ['skirt', 'leggings'] : [])]), color: pick(['#2f3f63', '#2f4e7a', '#3b2a20', '#5b5b5b', '#2a2a2e', '#c7b28a', '#2d5ca8']) },
      shoes: { style: pick(['simple', 'sneakers', 'boots']), color: pick(colors) },
      accessories: acc,
    };
  }
}

// ---------------------------------------------------------------- animation
function track(THREE, name, D, N, fn, kind = 'q') {
  const times = Array.from({ length: N + 1 }, (_, i) => (i / N) * D), v = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const t of times) {
    const r = fn((t / D) * Math.PI * 2);
    if (kind === 'q') { q.setFromEuler(e.set(r[0], r[1], r[2])); v.push(q.x, q.y, q.z, q.w); } else v.push(...r);
  }
  return kind === 'q' ? new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, v) : new THREE.VectorKeyframeTrack(`${name}.position`, times, v);
}
function armTrack(THREE, rig, side, D, N, free) {
  const s = side === 'L' ? 1 : -1, item = rig.hands[side];
  if (item?.def.pose) { const { x = 0, z = 0 } = item.def.pose; return track(THREE, 'Arm' + side, D, N, (p) => [x + Math.sin(p * 2) * 0.04, 0, -z * s]); }
  return track(THREE, 'Arm' + side, D, N, (p) => free(p, item?.def.swing ?? 1, s));
}
function walkClip(THREE, rig) {
  const { d } = rig, D = 0.9, N = 16, sin = Math.sin;
  const tracks = [
    track(THREE, 'Hips', D, N, (p) => [0, d.legL + Math.abs(sin(p)) * 0.45, 0], 'v'),
    track(THREE, 'Body', D, N, (p) => [0, 0, sin(p) * 0.04]),
    track(THREE, 'Spine', D, N, (p) => [0.05, -sin(p) * 0.08, 0]),
    track(THREE, 'Neck', D, N, (p) => [-0.04 + Math.abs(sin(p)) * 0.06, sin(p) * 0.08, -sin(p) * 0.05]),
    track(THREE, 'LegL', D, N, (p) => [-sin(p) * 0.55, 0, 0]),
    track(THREE, 'LegR', D, N, (p) => [sin(p) * 0.55, 0, 0]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.6 * sw, 0, 0.12 * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.6 * sw, 0, 0.12 * s]),
  ];
  for (const side of ['L', 'R']) {
    const it = rig.hands[side];
    if (it && !it.def.pose && rig.itemNodes[side]) tracks.push(track(THREE, 'Item' + side, D, N, (p) => [sin(p - 0.6) * 0.15 * (side === 'L' ? -1 : 1), 0, 0]));
  }
  return new THREE.AnimationClip('Walk', D, tracks);
}
function idleClip(THREE, rig) {
  const { d } = rig, D = 3, N = 24, sin = Math.sin;
  return new THREE.AnimationClip('Idle', D, [
    track(THREE, 'Hips', D, N, (p) => [0, d.legL - Math.abs(sin(p)) * 0.1, 0], 'v'),
    track(THREE, 'Body', D, N, () => [0, 0, 0]),
    track(THREE, 'Spine', D, N, (p) => [sin(p * 2) * 0.015, 0, 0]),
    track(THREE, 'Neck', D, N, (p) => [0.03, sin(p) * 0.3, sin(p * 2) * 0.04]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.03]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.03]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.04, 0, (0.14 + sin(p * 2) * 0.02) * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.04, 0, (0.14 + sin(p * 2) * 0.02) * s]),
  ]);
}
function waveClip(THREE, rig) {
  const { d } = rig, D = 1.2, N = 24, sin = Math.sin;
  const waveSide = rig.hands.R && !rig.hands.L ? 'L' : rig.hands.R ? null : 'R';
  const wave = (side) => track(THREE, 'Arm' + side, D, N, (p) => [-0.25, 0, (2.1 + sin(p * 2) * 0.3) * (side === 'L' ? 1 : -1)]);
  return new THREE.AnimationClip('Wave', D, [
    track(THREE, 'Hips', D, N, (p) => [0, d.legL + Math.abs(sin(p)) * 0.12, 0], 'v'),
    track(THREE, 'Body', D, N, () => [0, 0, 0]),
    track(THREE, 'Spine', D, N, (p) => [0, 0, sin(p * 2) * 0.03 * (waveSide === 'L' ? 1 : -1)]),
    track(THREE, 'Neck', D, N, (p) => [0.05, 0, (waveSide === 'L' ? 0.12 : -0.12) + sin(p * 2) * 0.04]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.03]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.03]),
    waveSide === 'L' ? wave('L') : armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [0, 0, 0.14 * s]),
    waveSide === 'R' ? wave('R') : armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [0, 0, 0.14 * s]),
  ]);
}
function rideClip(THREE, rig, moving) {
  const { d, ride } = rig, D = 2, N = 24, sin = Math.sin, hover = ride.def.hover;
  const tracks = [
    track(THREE, 'Ride', D, N, (p) => [0, (hover ? 1.2 : 0) + sin(p * (hover ? 1 : 8)) * (hover ? 0.6 : moving ? 0.06 : 0), 0], 'v'),
    track(THREE, 'Hips', D, N, (p) => [0, d.legL * Math.cos(0.2) + Math.abs(sin(p * 2)) * 0.15, 0], 'v'),
    track(THREE, 'Spine', D, N, (p) => [0.05, 0, moving ? sin(p) * 0.06 : 0]),
    track(THREE, 'Neck', D, N, (p) => [0, -1.15 + (moving ? 0 : sin(p) * 0.25), 0]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.2]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.2]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.1, 0, (0.6 + sin(p * 2) * 0.1) * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.1, 0, (0.6 + sin(p * 2 + 1) * 0.1) * s]),
  ];
  if (hover) tracks.push(track(THREE, 'Board', D, N, (p) => [sin(p) * 0.04, 0, sin(p * 2) * 0.03]));
  return new THREE.AnimationClip(moving ? 'Ride' : 'Idle', D, tracks);
}
