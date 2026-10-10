// BlockyCharacter — mix-and-match voxel-style characters for three.js
// --------------------------------------------------------------------
//   import * as THREE from 'three';
//   import { BlockyCharacter, PRESETS } from './blocky-character.js';
//
//   const hero = new BlockyCharacter(THREE, { body: 'female', hair: { style: 'bun', color: '#2b1b14' },
//                                            top: { style: 'hoodie', color: '#4e7bd8' },
//                                            accessories: ['headphones', 'phone'] });
//   scene.add(hero.root);
//   hero.play('Walk');                 // 'Walk' | 'Idle' | 'Ride' (see hero.clipNames)
//   // every frame: hero.update(delta)
//
//   hero.set({ top: { style: 'jacket' } });    // rebuilds in place, keeps position & animation
//   new BlockyCharacter(THREE, PRESETS.skater);
//
// All sizes are in "pixels" (px). Default px = 0.056 → an average adult is ~1.8 units tall.
// Characters face +Z with feet on y = 0.

// ---------------------------------------------------------------- palettes
export const SKIN_TONES = {
  porcelain: '#ffe0cc', fair: '#f6c9a6', light: '#eab38c', medium: '#d39b72',
  olive: '#c08a5c', tan: '#a8704a', brown: '#87573a', dark: '#653f29', deep: '#46291b',
};
export const HAIR_COLORS = {
  black: '#1f1a18', darkBrown: '#3b2519', brown: '#5e3b24', auburn: '#8a3a22', ginger: '#b8402b',
  blonde: '#d9b25f', platinum: '#ece0c0', grey: '#9a9a9a', white: '#eeeeee',
  pink: '#e86fa3', blue: '#4a7fe0', green: '#3fae6c', purple: '#8a5ad8',
};
export const EYE_COLORS = { brown: '#3b2416', dark: '#1d1411', hazel: '#6b5a2e', green: '#3f7a4a', blue: '#3e6fb0', grey: '#6d7b86' };

// ---------------------------------------------------------------- body shapes
export const BUILDS = {
  skinny:  { tw: 7,  td: 3.5, legW: 3.5, armDelta: -0.5 },
  average: { tw: 8,  td: 4,   legW: 4,   armDelta: 0 },
  chubby:  { tw: 10, td: 5.5, legW: 4.5, armDelta: 0.5 },
};
export const HEIGHTS = {
  short:   { th: 10, legL: 11 },
  average: { th: 12, legL: 12 },
  tall:    { th: 13, legL: 14.5 },
};

// ---------------------------------------------------------------- defaults
export const DEFAULT_MALE = {
  name: 'Default Male', body: 'male', build: 'average', height: 'average',
  skin: SKIN_TONES.light, eyes: EYE_COLORS.brown, freckles: false,
  hair: { style: 'short', color: HAIR_COLORS.brown },
  facialHair: { style: 'none' },
  top: { style: 'tshirt', color: '#4f86d9' },
  bottom: { style: 'pants', color: '#3b4357' },
  shoes: { style: 'simple', color: '#2d2a2a' },
  accessories: [],
};
export const DEFAULT_FEMALE = {
  ...DEFAULT_MALE, name: 'Default Female', body: 'female',
  hair: { style: 'long', color: HAIR_COLORS.brown },
};

// ---------------------------------------------------------------- color helpers
function toColorNum(THREE, c, fallback = 0xff00ff) {
  if (c === undefined || c === null) return fallback;
  if (typeof c === 'number') return c;
  const named = SKIN_TONES[c] || HAIR_COLORS[c] || EYE_COLORS[c];
  return new THREE.Color(named || c).getHex();
}
function shade(THREE, c, f) {
  const col = new THREE.Color(c);
  if (f < 1) col.multiplyScalar(f);
  else col.lerp(new THREE.Color(0xffffff), f - 1);
  return col.getHex();
}
function mix(THREE, a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }

// ---------------------------------------------------------------- registries
// Every part gets a context `k` with: box(), joint(), nodes, d (body dims), cfg, color helpers.
// Add your own entries to these objects (or use BlockyCharacter.register*) to extend the library.

export const HAIR_STYLES = {
  none: () => {},
  buzz: (k, c) => {
    k.box(k.n.head, 8.3, 0.8, 8.3, 0, 8.25, 0, c);
    k.box(k.n.head, 8.3, 3.5, 0.5, 0, 6.5, -4.05, c);
  },
  short: (k, c) => shortBase(k, c),
  quiff: (k, c) => {
    shortBase(k, c);
    if (k.flags.hat) return;
    k.box(k.n.head, 6, 1.5, 4, 0.5, 9.5, 1.5, c);
    k.box(k.n.head, 4, 1, 2.8, 1, 10.5, 1.9, k.shade(c, 0.78));
  },
  spiky: (k, c) => {
    shortBase(k, c);
    if (k.flags.hat) return;
    [[-2.5, 1.5], [0, 2.2], [2.5, 1.2], [-1.2, -1.5], [1.5, -1.8]].forEach(([x, z], i) =>
      k.box(k.n.head, 1.6, 1.6 + (i % 2) * 0.6, 1.6, x, 9.6 + (i % 2) * 0.3, z, i % 2 ? k.shade(c, 0.85) : c));
  },
  afro: (k, c) => {
    if (k.flags.hat) return shortBase(k, c);
    k.box(k.n.head, 10, 4.5, 10, 0, 9.25, -0.5, c);
    k.box(k.n.head, 10, 5, 6, 0, 5, -2.5, c);
  },
  long: (k, c) => {
    shortBase(k, c);
    for (const s of [1, -1]) k.box(k.n.head, 1, 8.5, 5.5, 4.4 * s, 4.25, -1.75, c);
    k.box(k.n.head, 8.6, 8, 1.2, 0, 4.5, -4.65, c);
    k.box(k.n.head, 8, 4, 1, 0, -1.5, -(k.d.td / 2 + 0.6), k.shade(c, 0.92));
  },
  bob: (k, c) => {
    shortBase(k, c);
    for (const s of [1, -1]) k.box(k.n.head, 1, 6, 7, 4.4 * s, 5, -0.5, c);
    k.box(k.n.head, 8.8, 6, 1, 0, 5, -4.4, c);
  },
  ponytail: (k, c) => {
    shortBase(k, c);
    k.box(k.n.head, 2.2, 1.2, 1.4, 0, 6.5, -5.2, k.shade(c, 0.7));
    k.box(k.n.head, 2, 6, 1.6, 0, 3, -5.5, c);
  },
  bun: (k, c) => {
    shortBase(k, c);
    if (k.flags.hat) return;
    k.box(k.n.head, 4, 3, 4, 0, 10.4, -1.5, c);
    k.box(k.n.head, 4.3, 0.6, 4.3, 0, 9.2, -1.5, k.shade(c, 0.7));
  },
  pigtails: (k, c) => {
    shortBase(k, c);
    for (const s of [1, -1]) {
      k.box(k.n.head, 1.6, 5, 1.6, 5.2 * s, 3.5, -1.5, c);
      k.box(k.n.head, 1.9, 0.6, 1.9, 5.2 * s, 6.2, -1.5, k.shade(c, 0.7));
    }
  },
  mohawk: (k, c) => {
    k.box(k.n.head, 8.2, 0.4, 8.2, 0, 8.6, 0, k.mix(c, k.skin, 0.55));
    if (k.flags.hat) return;
    k.box(k.n.head, 2, 3, 8.6, 0, 10.3, 0, c);
  },
};
function shortBase(k, c) {
  const h = k.n.head;
  k.box(h, 8.5, 1.5, 8.5, 0, 8.25, 0, c);
  k.box(h, 8.4, 4.8, 1, 0, 5.9, -4.1, c);
  for (const s of [1, -1]) k.box(h, 1, 3.5, 4.5, 3.65 * s, 6.25, -1.9, c);
  k.box(h, 8.5, 1, 1, 0, 7.5, 3.8, c);
}

export const FACIAL_HAIR = {
  none: () => {},
  stubble: (k, c) => {
    const col = k.mix(c, k.skin, 0.5);
    k.box(k.n.head, 7, 2.5, 0.2, 0, 1.85, 4.1, col);
    for (const s of [1, -1]) k.box(k.n.head, 0.2, 2.5, 4, 4.1 * s, 1.85, 1.5, col);
  },
  moustache: (k, c) => k.box(k.n.head, 4, 0.7, 0.35, 0, 3.95, 4.15, c),
  goatee: (k, c) => {
    k.box(k.n.head, 4, 0.7, 0.35, 0, 3.95, 4.15, c);
    k.box(k.n.head, 2.5, 2.5, 0.35, 0, 1.9, 4.15, c);
  },
  beard: (k, c) => {
    k.box(k.n.head, 8.5, 3.25, 8.5, 0, 1.875, 0, c);
    k.box(k.n.head, 4, 1, 1, 0, 1.1, 4.2, k.shade(c, 0.78));
    k.box(k.n.head, 4, 0.6, 0.3, 0, 3.9, 4.15, c);
  },
};

// tops: torso + sleeves. `long` sleeves end in a cuff, `short` stop at the bicep.
function torso(k, c) { return k.box(k.n.spine, k.d.tw, k.d.th, k.d.td, 0, k.d.th / 2, 0, c); }
function sleeves(k, len, c, cuff) {
  const { armW: w, armTop, handTop } = k.d;
  for (const arm of [k.n.armL, k.n.armR]) {
    if (len === 'long') {
      const h = armTop + 0.15 - handTop;
      k.box(arm, w + 0.3, h, w + 0.3, 0, armTop + 0.15 - h / 2, 0, c);
      k.box(arm, w + 0.5, 1.05, w + 0.5, 0, handTop + 0.45, 0, cuff ?? c);
    } else if (len === 'short') {
      k.box(arm, w + 0.3, 4.65, w + 0.3, 0, armTop + 0.15 - 2.325, 0, c);
    }
  }
}
const front = (k) => k.d.td / 2 + 0.1;
// finger blocks: each entry is [x, y, z, w, h, d] in the hand item's space
function grip(k, item, ...fingers) {
  const col = k.shade(k.skin, 0.95);
  for (const [x, y, z, w, h, d] of fingers) k.box(item, w, h, d, x, y, z, col);
}

export const TOPS = {
  tshirt: (k, c, a) => {
    torso(k, c); sleeves(k, 'short', c);
    k.box(k.n.spine, 3, 0.6, 0.2, 0, k.d.th - 0.4, front(k), k.shade(c, 0.8));
  },
  polo: (k, c, a) => {
    torso(k, c); sleeves(k, 'short', c);
    k.box(k.n.spine, 4, 0.9, 0.25, 0, k.d.th - 0.45, front(k), a ?? k.shade(c, 1.35));
    k.box(k.n.spine, 0.8, 3, 0.2, 0, k.d.th - 1.8, front(k), k.shade(c, 0.8));
  },
  longsleeve: (k, c) => { torso(k, c); sleeves(k, 'long', c, k.shade(c, 0.88)); },
  tanktop: (k, c) => {
    torso(k, c);
    k.box(k.n.spine, 3, 1.5, 0.2, 0, k.d.th - 0.75, front(k), k.skin);
  },
  hoodie: (k, c, a) => {
    torso(k, c); sleeves(k, 'long', c, k.shade(c, 0.85));
    const { th, td, tw } = k.d;
    k.box(k.n.spine, Math.min(7, tw - 1), 4.5, 1.4, 0, th, -(td / 2 + 2.1), k.shade(c, 0.9)); // hood
    k.box(k.n.spine, tw - 2, 2.5, 0.25, 0, 3, front(k), k.shade(c, 0.85));                    // pocket
    for (const s of [1, -1]) k.box(k.n.spine, 0.4, 2.5, 0.25, s, th - 2.5, front(k) + 0.02, a ?? 0xf2f2f2);
    k.box(k.n.spine, tw + 0.2, 1.2, td + 0.35, 0, 0.55, 0, k.shade(c, 0.85));                  // waistband
  },
  jacket: (k, c, a) => {
    torso(k, c); sleeves(k, 'long', c, a ?? 0xfff6ea);
    const { th, td, tw } = k.d, z = front(k);
    k.box(k.n.spine, 2.4, th - 0.5, 0.2, 0, th / 2 + 0.25, z, a ?? 0xfff6ea);                 // shirt
    for (const s of [1, -1]) k.box(k.n.spine, 0.5, th - 2, 0.25, 1.45 * s, th / 2 + 0.5, z + 0.02, k.shade(c, 0.78));
    k.box(k.n.spine, tw + 0.1, 3, td + 0.35, 0, 1.45, 0, c);                                      // hem
    k.box(k.n.spine, 2, 1, 0.3, -(tw / 4 + 0.5), 3.5, td / 2 + 0.25, k.shade(c, 0.78));      // pocket flap
  },
  sweater: (k, c, a) => {
    torso(k, c); sleeves(k, 'long', c, k.shade(c, 0.85));
    const { th, td, tw } = k.d;
    k.box(k.n.spine, tw + 0.2, 1.2, td + 0.35, 0, 0.55, 0, k.shade(c, 0.85));
    k.box(k.n.spine, tw + 0.2, 1.2, td + 0.35, 0, th * 0.58, 0, a ?? k.shade(c, 1.4));
  },
  dress: (k, c, a) => {
    torso(k, c); sleeves(k, 'short', c);
    const { tw, td } = k.d;
    k.box(k.n.hips, tw + 1, 5.5, td + 1.2, 0, -2.25, 0, c);
    k.box(k.n.hips, tw + 1.6, 2.5, td + 1.8, 0, -4.25, 0, c);
    k.box(k.n.spine, tw + 0.2, 0.8, td + 0.35, 0, 0.9, 0, a ?? k.shade(c, 0.75));
  },
};
TOPS.dress.coversLegs = true;

export const BOTTOMS = {
  bare: () => {},
  pants: (k, c) => legs(k, (leg) => k.box(leg, k.d.legW + 0.2, k.d.legL - 2.4, k.d.legW + 0.2, 0, -(k.d.legL - 2.4) / 2, 0, c)),
  widePants: (k, c) => legs(k, (leg) => {
    const L = k.d.legL - 2.4, w = k.d.legW + 0.2;
    k.box(leg, w, L, w, 0, -L / 2, 0, c);
    k.box(leg, w + 0.05, 1, w + 0.05, 0, -L + 0.5, 0, k.shade(c, 0.75));
  }),
  jeans: (k, c) => {
    legs(k, (leg) => {
      const L = k.d.legL - 2.4, w = k.d.legW + 0.2;
      k.box(leg, w, L, w, 0, -L / 2, 0, c);
      k.box(leg, w + 0.15, 1, w + 0.15, 0, -L + 0.4, 0, k.shade(c, 1.25));
    });
    k.box(k.n.spine, k.d.tw + 0.14, 0.8, k.d.td + 0.25, 0, 0.38, 0, 0x3b2a20);
    k.box(k.n.spine, 1.2, 0.6, 0.2, 0, 0.4, k.d.td / 2 + 0.2, 0xd9b25f);
  },
  joggers: (k, c, a) => legs(k, (leg, s) => {
    const L = k.d.legL - 2.4, w = k.d.legW + 0.2;
    k.box(leg, w, L, w, 0, -L / 2, 0, c);
    k.box(leg, w + 0.1, 1, w + 0.1, 0, -L + 0.5, 0, k.shade(c, 0.8));
    k.box(leg, 0.2, L - 1.5, 1, (w / 2 + 0.05) * s, -L / 2 + 0.75, 0, a ?? 0xf2f2f2);
  }),
  shorts: (k, c) => legs(k, (leg) => k.box(leg, k.d.legW + 0.2, k.d.legL * 0.38, k.d.legW + 0.2, 0, -k.d.legL * 0.19, 0, c)),
  skirt: (k, c) => k.box(k.n.hips, k.d.tw + 1, k.d.legL * 0.42, k.d.td + 1, 0, -k.d.legL * 0.21 + 0.2, 0, c),
  leggings: (k, c) => legs(k, (leg) => k.box(leg, k.d.legW + 0.1, k.d.legL - 2, k.d.legW + 0.1, 0, -(k.d.legL - 2) / 2, 0, c)),
};
function legs(k, fn) { fn(k.n.legL, 1); fn(k.n.legR, -1); }

export const SHOES = {
  bare: () => {},
  simple: (k, c) => legs(k, (leg) => {
    const w = k.d.legW, L = k.d.legL;
    k.box(leg, w + 0.25, 2.2, w + 0.25, 0, -L + 1.1, 0, c);
    k.box(leg, w + 0.3, 0.5, w + 0.9, 0, -L + 0.2, 0.35, k.shade(c, 0.7));
  }),
  sneakers: (k, c, a) => legs(k, (leg, s) => {
    const w = k.d.legW, L = k.d.legL, sole = a ?? 0xfbe9e7;
    k.box(leg, w + 0.1, 2, w + 0.1, 0, -L + 1, 0, c);
    k.box(leg, w + 0.28, 0.6, w + 1.2, 0, -L + 0.25, 0.6, sole);
    k.box(leg, w + 0.2, 1.3, 1.2, 0, -L + 0.9, w / 2 + 0.65, sole);
    k.box(leg, w / 2, 0.4, 1.6, 0, -L + 2.15, w / 2 - 0.85, sole);
  }),
  hightops: (k, c, a) => legs(k, (leg, s) => {
    const w = k.d.legW, L = k.d.legL, sole = a ?? 0xfbe9e7;
    k.box(leg, w + 0.25, 3.2, w + 0.25, 0, -L + 1.6, 0, c);
    k.box(leg, w + 0.32, 0.6, w + 1.2, 0, -L + 0.25, 0.6, sole);
    k.box(leg, w + 0.29, 1.3, 1.2, 0, -L + 0.9, w / 2 + 0.65, sole);
    k.box(leg, 0.2, 1, 1, (w / 2 + 0.2) * s, -L + 2.2, -1, sole);
  }),
  boots: (k, c) => legs(k, (leg) => {
    const w = k.d.legW, L = k.d.legL;
    k.box(leg, w + 0.3, 3.6, w + 0.3, 0, -L + 1.8, 0, c);
    k.box(leg, w + 0.36, 0.7, w + 1, 0, -L + 0.3, 0.45, k.shade(c, 0.6));
    k.box(leg, 1.2, 2.5, 0.2, 0, -L + 2.3, w / 2 + 0.25, k.shade(c, 0.7));
  }),
};

// Accessories. slot: head | face | body | back | hand | ride
// hand items: hand 'L' | 'R' | 'both', pose = arm angles while holding, upright = keep item level.
export const ACCESSORIES = {
  cap: { slot: 'head', hat: true, color: '#d64545', build: (k, c) => {
    k.box(k.n.head, 8.7, 2.6, 8.7, 0, 8.6, 0, c);
    k.box(k.n.head, 8, 0.5, 4, 0, 7.6, 5.8, k.shade(c, 0.82));
    k.box(k.n.head, 1, 0.4, 1, 0, 10.05, 0, k.shade(c, 0.82));
  } },
  beanie: { slot: 'head', hat: true, color: '#e0a23a', build: (k, c, a) => {
    k.box(k.n.head, 8.8, 3.8, 8.8, 0, 9.1, 0, c);
    k.box(k.n.head, 9.1, 1.3, 9.1, 0, 7.6, 0, k.shade(c, 0.82));
    k.box(k.n.head, 2, 1.5, 2, 0, 11.75, 0, a ?? 0xf5f0e6);
  } },
  headphones: { slot: 'head', color: '#2a2d34', build: (k, c, a) => {
    const y = k.has('beanie') ? 11.5 : k.has('cap') ? 10.4 : k.cfg.hair.style === 'afro' ? 12 : (k.flags.tallHair ? 11.2 : 9.55);
    k.box(k.n.head, 10.2, 1, 1.6, 0, y, 0, c);
    for (const s of [1, -1]) {
      k.box(k.n.head, 0.8, y - 6.6, 1.4, 4.75 * s, (y + 6.6) / 2, 0, c);
      k.box(k.n.head, 1.5, 3.2, 3, 4.95 * s, 5.2, 0.5, a ?? 0xe25563);
    }
  } },
  glasses: { slot: 'face', color: '#2a2320', build: (k, c) => {
    k.box(k.n.head, 7.6, 0.45, 0.3, 0, 6.35, 4.65, c);
    for (const s of [1, -1]) {
      k.box(k.n.head, 2.8, 2, 0.2, 1.7 * s, 5.35, 4.62, 0xcfe8ff, { opacity: 0.35 });
      k.box(k.n.head, 0.3, 0.4, 4.6, 4.3 * s, 6.35, 2.35, c);
    }
  } },
  sunglasses: { slot: 'face', color: '#15161b', build: (k, c) => {
    k.box(k.n.head, 7.8, 0.5, 0.3, 0, 6.45, 4.65, c);
    for (const s of [1, -1]) {
      k.box(k.n.head, 3, 2, 0.25, 1.75 * s, 5.45, 4.6, c);
      k.box(k.n.head, 0.3, 0.4, 4.6, 4.3 * s, 6.45, 2.35, c);
    }
  } },
  earrings: { slot: 'face', color: '#e8c25a', build: (k, c) => {
    for (const s of [1, -1]) k.box(k.n.head, 0.5, 0.8, 0.5, 4.25 * s, 3.4, 0.9, c);
  } },
  watch: { slot: 'body', color: '#1d2633', build: (k, c) => {
    const arm = k.flags.handL ? k.n.armR : k.n.armL, s = arm === k.n.armL ? 1 : -1, w = k.d.armW;
    k.box(arm, w + 0.6, 0.8, w + 0.6, 0, k.d.handTop - 0.5, 0, c);
    k.box(arm, 0.3, 1.2, 1.4, (w / 2 + 0.45) * s, k.d.handTop - 0.5, 0, 0x9fb4c8);
  } },
  scarf: { slot: 'body', color: '#c9473f', build: (k, c, a) => {
    const { th, td, tw } = k.d;
    k.box(k.n.spine, Math.min(tw + 0.6, 9.2), 1.6, td + 0.6, 0, th - 0.7, 0, c);
    k.box(k.n.spine, 1.8, 5, 0.6, 1.8, th - 3.5, td / 2 + 0.5, c);
    k.box(k.n.spine, 1.9, 0.6, 0.65, 1.8, th - 4.5, td / 2 + 0.5, a ?? 0xf5f0e6);
  } },
  tie: { slot: 'body', color: '#2f3d6e', build: (k, c) => {
    const { th } = k.d, z = front(k) + 0.1;
    k.box(k.n.spine, 1.4, 1, 0.4, 0, th - 0.7, z, c);
    k.box(k.n.spine, 1.2, 6, 0.3, 0, th - 4.2, z, c);
  } },
  camera: { slot: 'body', color: '#2b2b30', build: (k, c) => {
    const { th, td } = k.d, z = td / 2 + 0.9;
    k.box(k.n.spine, 3.6, 2.4, 1.6, 0, th * 0.45, z, c);
    k.box(k.n.spine, 1.6, 1.6, 0.8, 0, th * 0.45, z + 1.1, 0x50555e);
    k.box(k.n.spine, 0.8, 0.5, 0.4, -1.2, th * 0.45 + 1.4, z, 0xd64545);
    for (const s of [1, -1]) {
      const strap = k.box(k.n.spine, 0.4, th * 0.6, 0.3, 1.6 * s, th * 0.75, td / 2 + 0.2, 0x3b2a20);
      strap.rotation.z = 0.25 * s;
    }
  } },
  backpack: { slot: 'back', color: '#3f7a5a', build: (k, c) => {
    const { th, td } = k.d, z = -(td / 2 + 1.6);
    k.box(k.n.spine, 6.5, th * 0.62, 3, 0, th * 0.54, z, c);
    k.box(k.n.spine, 4.5, th * 0.25, 0.4, 0, th * 0.37, z - 1.7, k.shade(c, 0.8));
    for (const s of [1, -1]) k.box(k.n.spine, 1, th * 0.8, 0.3, 2.5 * s, th * 0.55, td / 2 + 0.15, k.shade(c, 0.7));
  } },
  guitar: { slot: 'back', color: '#c9702e', build: (k, c) => {
    const { th, td } = k.d;
    const gz = -(td / 2 + 2.6) - (k.has('backpack') ? 2.2 : 0);
    const g = k.joint(k.n.spine, 'Guitar', 0, th / 2, gz);
    g.rotation.z = 0.55;
    k.box(g, 6, 6.5, 1.8, 0, -2, 0, c);
    k.box(g, 7, 3.5, 1.8, 0, -4.5, 0, c);
    k.box(g, 1.6, 1.6, 0.2, 0, -1.2, -1, 0x2a1a12);
    k.box(g, 1.2, 10, 0.8, 0, 6, 0, 0x5a3a22);
    k.box(g, 1.8, 2, 0.9, 0, 12, 0, 0x3a2416);
    const strap = k.box(k.n.spine, 1, th * 1.15, 0.3, 0, th / 2, td / 2 + 0.25, 0x2b1d18);
    strap.rotation.z = 0.6;
  } },
  briefcase: { slot: 'hand', hand: 'R', swing: 0.25, color: '#4a1f1c', build: (k, c, a, hand) => {
    const dk = k.shade(c, 0.64);
    for (const z of [-1.5, 1.5]) k.box(hand, 1, 2, 1, 0, -1.5, z, dk);
    k.box(hand, 1, 1, 4, 0, -0.5, 0, dk);
    k.box(hand, 2.5, 6, 9, 0, -5.5, 0, c);
    k.box(hand, 2.75, 2.1, 9.25, 0, -3.45, 0, dk);
    k.box(hand, 3, 1, 1.5, 0, -4.5, 0, 0xfbe9e7);
  } },
  // Hand items sit beside or in front of the hand (never inside it). `grip()` adds skin-colored
  // finger blocks over the item so it reads as held. Items are a little oversized on purpose.
  book: { slot: 'hand', hand: 'L', swing: 0.4, color: '#3a6ea5', build: (k, c, a, hand, s) => {
    const w = k.d.armW, x = (w / 2 + 1.0) * s;
    k.box(hand, 2, 7, 5.6, x, -1, 0, c);
    k.box(hand, 1.7, 6.6, 5.2, x + 0.1 * s, -1, 0.35, 0xf7f2e6);
    k.box(hand, 0.3, 7.2, 0.6, x - 0.85 * s, -1, -2.6, k.shade(c, 0.7));    // spine
    grip(k, hand, [x + 1.1 * s, 0.4, 0, 0.25, 2, 2.4]);                      // fingers over the cover
  } },
  phone: { slot: 'hand', hand: 'R', pose: { x: -1.0, z: 0.25 }, upright: 0.9, color: '#3d7bf2', build: (k, c, a, hand) => {
    const z = k.d.armW / 2 + 0.55;
    k.box(hand, 2.8, 4.8, 0.6, 0, 1.6, z, c);                                // case (faces outward)
    k.box(hand, 0.9, 0.9, 0.2, 0.7, 3.3, z + 0.35, 0x1d2026);                // camera bump
    k.box(hand, 2.5, 4.4, 0.1, 0, 1.6, z - 0.33, a ?? 0x7fd4ff, { emissive: 0.8 }); // screen (faces you)
    grip(k, hand, [1.55, 0.6, z, 0.3, 1.8, 0.9], [-1.55, 0.6, z, 0.3, 1.8, 0.9]);
  } },
  tablet: { slot: 'hand', hand: 'both', pose: { x: -0.95, z: 0.1 }, upright: 0.75, color: '#e8ecf2', build: (k, c, a, hand, s) => {
    const hx = k.d.sx - k.d.th * 0.1, x = -hx * s, z = k.d.armW / 2 + 1.0;
    k.box(hand, 10, 7, 0.6, x, 2.4, z, c);                                   // bezel
    k.box(hand, 8.8, 5.8, 0.1, x, 2.4, z - 0.33, a ?? 0x7fd4ff, { emissive: 0.7 }); // screen toward the holder
    k.box(hand, 8.8, 5.8, 0.1, x, 2.4, z + 0.33, k.shade(c, 0.85));         // back plate
    for (const hxl of [0, -2 * hx * s]) grip(k, hand, [hxl, 0.2, z + 0.5, 1.4, 1.8, 0.3], [hxl, 0.2, z - 0.5, 1.4, 1.8, 0.3]);
  } },
  coffee: { slot: 'hand', hand: 'L', pose: { x: -0.75, z: 0.1 }, upright: 1, color: '#f7f2ea', build: (k, c, a, hand, s) => {
    const w = k.d.armW, x = -(w / 2 + 1.5) * s;
    k.box(hand, 2.8, 3.8, 2.8, x, 0.6, 0.4, c);                              // cup
    k.box(hand, 3.1, 0.7, 3.1, x, 2.85, 0.4, 0x3b2a20);                      // lid
    k.box(hand, 0.8, 0.5, 0.8, x, 3.4, 0.4, 0x3b2a20);                       // sip spout
    k.box(hand, 2.95, 1.5, 2.95, x, 0.4, 0.4, a ?? 0xd9653b);                // sleeve
    grip(k, hand, [x + 0.7 * s, 0.5, 0.4 + 1.6, 1.6, 1.4, 0.3], [x + 0.7 * s, 0.5, 0.4 - 1.6, 1.6, 1.4, 0.3]);
  } },
  skateboard: { slot: 'ride', color: '#d9653b', build: (k, c, a) => {
    const r = k.n.ride;
    k.box(r, 5, 0.6, 18, 0, 2.9, 0, c);
    k.box(r, 4.8, 0.1, 17.6, 0, 3.25, 0, 0x2a2a2e);
    for (const s of [1, -1]) {
      const tail = k.box(r, 5, 0.6, 3, 0, 3.35, 10.2 * s, c);
      tail.rotation.x = -0.35 * s;
      k.box(r, 3.5, 0.8, 1.2, 0, 2.2, 6 * s, 0x9aa0a8);
      for (const x of [2.3, -2.3]) k.box(r, 1.2, 1.6, 1.6, x, 0.8, 6 * s, a ?? 0xf2efe6);
    }
    return 3.35;
  } },
  hoverboard: { slot: 'ride', hover: true, color: '#e8ecf2', build: (k, c, a) => {
    const r = k.n.board;
    k.box(r, 6, 1.2, 16, 0, 3.6, 0, c);
    k.box(r, 6.2, 0.3, 14, 0, 3.6, 0, a ?? 0x37d6ff, { emissive: 1 });
    k.box(r, 4.5, 0.3, 13, 0, 2.85, 0, a ?? 0x37d6ff, { emissive: 1.2 });
    return 4.2;
  } },
};

// ---------------------------------------------------------------- the class
export class BlockyCharacter {
  constructor(THREE, config = {}, { px = 0.056 } = {}) {
    this.THREE = THREE;
    this.px = px;
    this.root = new THREE.Group();
    this.root.name = 'Character';
    this.mixer = new THREE.AnimationMixer(this.root);
    this.current = null;
    this.set(config, true);
  }

  static normalize(config = {}) {
    const base = config.body === 'female' ? DEFAULT_FEMALE : DEFAULT_MALE;
    const part = (v, def) => (typeof v === 'string' ? { ...def, style: v } : { ...def, ...(v || {}) });
    const out = {
      ...base, ...config,
      hair: part(config.hair, base.hair),
      facialHair: part(config.facialHair, base.facialHair),
      top: part(config.top, base.top),
      bottom: part(config.bottom, base.bottom),
      shoes: part(config.shoes, base.shoes),
      accessories: (config.accessories ?? base.accessories).map((a) => (typeof a === 'string' ? { type: a } : { ...a })),
    };
    return out;
  }

  /** Change any part of the config and rebuild in place. */
  set(patch = {}, replace = false) {
    const prev = this.config ?? {};
    const merged = replace ? patch : { ...prev, ...patch };
    this.config = BlockyCharacter.normalize(merged);
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
    if (this.clips) this.clips.forEach((c) => this.mixer.uncacheClip(c));
    this.mixer.uncacheRoot(this.root);
    for (const child of [...this.root.children]) this.root.remove(child);
    (this._geoms || []).forEach((g) => g.dispose());
    (this._mats ? [...this._mats.values()] : []).forEach((m) => m.dispose());
    this._geoms = [];
    this._mats = new Map();
  }

  _build() {
    const THREE = this.THREE, px = this.px, cfg = this.config;
    const female = cfg.body === 'female';
    const B = BUILDS[cfg.build] ?? BUILDS.average, H = HEIGHTS[cfg.height] ?? HEIGHTS.average;
    const armW = (female ? 3 : 4) + B.armDelta;
    const d = {
      ...B, ...H, armW,
      legX: B.tw / 4 + 0.15,
      sx: B.tw / 2 + armW / 2 + 0.15,
      armTop: 2, handTop: -(H.th - 2) + 3, // arm runs from +2 (above shoulder) to -(th-2)
    };
    d.handY = d.handTop - 1.5;

    const mat = (color, o = {}) => {
      const key = `${color}|${o.opacity ?? 1}|${o.emissive ?? 0}`;
      if (!this._mats.has(key)) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
        if (o.opacity !== undefined) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
        if (o.emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = o.emissive; }
        this._mats.set(key, m);
      }
      return this._mats.get(key);
    };
    const box = (parent, w, h, dd, x, y, z, color, o) => {
      const g = new THREE.BoxGeometry(w * px, h * px, dd * px);
      this._geoms.push(g);
      const m = new THREE.Mesh(g, mat(color, o));
      m.position.set(x * px, y * px, z * px);
      m.castShadow = o?.opacity === undefined;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const joint = (parent, name, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x * px, y * px, z * px);
      parent.add(g);
      return g;
    };

    // resolve colors
    const C = (c, f) => toColorNum(THREE, c, f);
    const skinNum = C(cfg.skin);

    // accessories → slots
    const acc = cfg.accessories
      .map((a) => ({ ...a, def: ACCESSORIES[a.type] }))
      .filter((a) => a.def);
    const hands = {};
    const warnings = [];
    let ride = null;
    for (const a of acc) {
      if (a.def.slot === 'hand') {
        const want = a.def.hand === 'both' ? ['L', 'R'] : [a.side ?? a.def.hand];
        for (const h of want) {
          if (hands[h]) warnings.push(`${a.type} replaced ${hands[h].type} in hand ${h}`);
          hands[h] = a;
        }
      }
      if (a.def.slot === 'ride') { if (ride) warnings.push(`${a.type} replaced ${ride.type}`); ride = a; }
    }
    this.warnings = warnings;
    const flags = {
      hat: acc.some((a) => a.def.hat),
      tallHair: ['quiff', 'spiky', 'afro', 'bun', 'mohawk'].includes(cfg.hair.style),
      handL: !!hands.L, handR: !!hands.R, ride: ride?.type, hover: !!ride?.def.hover,
    };

    // skeleton
    const n = {};
    n.ride = joint(this.root, 'Ride');
    n.board = joint(n.ride, 'Board');
    n.body = joint(n.ride, 'Body');
    n.hips = joint(n.body, 'Hips', 0, d.legL, 0);
    n.legL = joint(n.hips, 'LegL', d.legX, 0, 0);
    n.legR = joint(n.hips, 'LegR', -d.legX, 0, 0);
    n.spine = joint(n.hips, 'Spine');
    n.neck = joint(n.spine, 'Neck', 0, d.th - 0.5, 0);
    n.head = joint(n.neck, 'Head');
    n.armL = joint(n.spine, 'ArmL', d.sx, d.th - 2, 0);
    n.armR = joint(n.spine, 'ArmR', -d.sx, d.th - 2, 0);
    n.handL = joint(n.armL, 'HandL', 0, d.handY, 0);
    n.handR = joint(n.armR, 'HandR', 0, d.handY, 0);

    const k = {
      THREE, n, d, cfg, flags, box, joint, skin: skinNum,
      shade: (c, f) => shade(THREE, c, f), mix: (a, b, t) => mix(THREE, a, b, t),
      has: (type) => acc.some((a) => a.type === type),
    };

    // skin base
    const skin = skinNum, skinShade = shade(THREE, skin, 0.86);
    for (const leg of [n.legL, n.legR]) box(leg, d.legW, d.legL, d.legW, 0, -d.legL / 2, 0, skin);
    for (const arm of [n.armL, n.armR]) {
      const len = d.armTop - (d.handTop - 3);
      box(arm, armW, len, armW, 0, d.armTop - len / 2, 0, skin);
    }
    box(n.head, 8, 8, 8, 0, 4.5, 0, skin);

    // clothes
    const topFn = TOPS[cfg.top.style] ?? TOPS.tshirt;
    topFn(k, C(cfg.top.color), cfg.top.accent !== undefined ? C(cfg.top.accent) : undefined);
    let bottomStyle = cfg.bottom.style;
    if (topFn.coversLegs && !['leggings', 'bare'].includes(bottomStyle)) bottomStyle = 'bare';
    (BOTTOMS[bottomStyle] ?? BOTTOMS.pants)(k, C(cfg.bottom.color), cfg.bottom.accent !== undefined ? C(cfg.bottom.accent) : undefined);
    (SHOES[cfg.shoes.style] ?? SHOES.simple)(k, C(cfg.shoes.color), cfg.shoes.accent !== undefined ? C(cfg.shoes.accent) : undefined);

    // face
    const hairC = C(cfg.hair.color);
    const fhStyle = cfg.facialHair.style;
    (HAIR_STYLES[cfg.hair.style] ?? HAIR_STYLES.short)(k, hairC);
    (FACIAL_HAIR[fhStyle] ?? FACIAL_HAIR.none)(k, C(cfg.facialHair.color ?? cfg.hair.color));
    const brow = cfg.hair.style === 'none' ? shade(THREE, skin, 0.55) : shade(THREE, hairC, 0.8);
    for (const s of [1, -1]) {
      box(n.head, 1, 1, 0.3, 1.5 * s, 5.5, 4.1, C(cfg.eyes));
      box(n.head, 0.5, 1, 0.3, 2.25 * s, 5.5, 4.08, 0xfff6ea);
      box(n.head, 1.5, 0.4, 0.3, 1.6 * s, 6.6, 4.1, brow);
      box(n.head, 0.4, 1.5, 1.2, 4.1 * s, 4.6, 0.9, skinShade);
      if (female) box(n.head, 0.5, 0.4, 0.3, 2.6 * s, 6.1, 4.12, 0x2a1512);
      if (cfg.freckles) for (const [x, y] of [[2.4, 4.2], [3.1, 4.6], [2.9, 3.8]]) box(n.head, 0.4, 0.4, 0.22, x * s, y, 4.05, shade(THREE, skin, 0.72));
    }
    box(n.head, 1, 1.4, 0.6, 0, 4.6, 4.2, skinShade);
    if (fhStyle === 'beard') box(n.head, 3, 0.5, 0.3, 0, 3.4, 4.2, skinShade);
    else if (fhStyle !== 'goatee') box(n.head, 2, 0.4, 0.25, 0, 3.0, 4.1, female ? C(cfg.lips ?? '#c4566a') : shade(THREE, skin, 0.7));

    // accessories
    const itemNodes = {};
    let boardTop = 0;
    for (const a of acc) {
      const c = C(a.color ?? a.def.color), ac = a.accent !== undefined ? C(a.accent) : undefined;
      if (a.def.slot === 'hand') {
        const sides = a.def.hand === 'both' ? ['L'] : [a.side ?? a.def.hand];
        for (const h of sides) {
          if (hands[h] !== a) continue;
          const item = joint(n['hand' + h], 'Item' + h);
          if (a.def.upright) item.rotation.set(-(a.def.pose?.x ?? 0) * a.def.upright, 0, (a.def.pose?.z ?? 0) * (h === 'L' ? 1 : -1));
          itemNodes[h] = item;
          a.def.build(k, c, ac, item, h === 'L' ? 1 : -1);
        }
      } else if (a.def.slot === 'ride') {
        if (ride === a) boardTop = a.def.build(k, c, ac) ?? 0;
      } else {
        a.def.build(k, c, ac);
      }
    }

    // stance on a board: stand sideways and look forward
    if (ride) {
      n.body.position.y = boardTop * px;
      n.body.rotation.y = 1.35;
    }

    // animation
    const rig = { d, px, hands, ride, flags, itemNodes };
    this.clips = ride
      ? [rideClip(THREE, rig, true), rideClip(THREE, rig, false)]
      : [walkClip(THREE, rig), idleClip(THREE, rig), waveClip(THREE, rig)];
    this.defaultClip = this.clips[0].name;
  }

  // ---- registry helpers
  static registerAccessory(name, def) { ACCESSORIES[name] = def; }
  static registerHair(name, fn) { HAIR_STYLES[name] = fn; }
  static registerTop(name, fn) { TOPS[name] = fn; }
  static registerBottom(name, fn) { BOTTOMS[name] = fn; }
  static registerShoes(name, fn) { SHOES[name] = fn; }

  static get options() {
    return {
      body: ['male', 'female'], build: Object.keys(BUILDS), height: Object.keys(HEIGHTS),
      hair: Object.keys(HAIR_STYLES), facialHair: Object.keys(FACIAL_HAIR),
      top: Object.keys(TOPS), bottom: Object.keys(BOTTOMS), shoes: Object.keys(SHOES),
      accessories: Object.keys(ACCESSORIES),
    };
  }

  /** Random but coherent character. Pass a seed for repeatable results. */
  static random(seed = Math.random() * 1e9) {
    let s = Math.floor(seed) || 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const body = pick(['male', 'female']);
    const hairPool = body === 'female' ? ['long', 'bob', 'ponytail', 'bun', 'pigtails', 'afro', 'short'] : ['short', 'quiff', 'buzz', 'spiky', 'afro', 'none', 'mohawk', 'long'];
    const colors = ['#4f86d9', '#d64545', '#3fae6c', '#e0a23a', '#8a5ad8', '#2d2d33', '#f2ece2', '#e86fa3', '#2f8f8f', '#b3213d'];
    const acc = [];
    const head = pick([null, null, 'cap', 'beanie', 'headphones']);
    if (head) acc.push(head);
    if (r() < 0.3) acc.push(pick(['glasses', 'sunglasses']));
    if (r() < 0.35) acc.push(pick(['backpack', 'scarf', 'watch', 'camera']));
    if (r() < 0.45) acc.push(pick(['phone', 'coffee', 'book', 'tablet', 'briefcase']));
    if (r() < 0.12) acc.push(pick(['skateboard', 'hoverboard']));
    return {
      name: 'Random', body,
      build: pick(['skinny', 'average', 'average', 'chubby']), height: pick(['short', 'average', 'average', 'tall']),
      skin: pick(Object.values(SKIN_TONES)), eyes: pick(Object.values(EYE_COLORS)), freckles: r() < 0.15,
      hair: { style: pick(hairPool), color: pick(Object.values(HAIR_COLORS).slice(0, r() < 0.15 ? 13 : 9)) },
      facialHair: { style: body === 'male' ? pick(['none', 'none', 'stubble', 'moustache', 'goatee', 'beard']) : 'none' },
      top: { style: pick(body === 'female' ? Object.keys(TOPS) : Object.keys(TOPS).filter((t) => t !== 'dress')), color: pick(colors) },
      bottom: { style: pick(['pants', 'jeans', 'joggers', 'shorts', 'widePants', ...(body === 'female' ? ['skirt', 'leggings'] : [])]), color: pick(['#3b4357', '#2f4e7a', '#3b1714', '#5b5b5b', '#2a2a2e', '#c7b28a']) },
      shoes: { style: pick(['simple', 'sneakers', 'hightops', 'boots']), color: pick(colors) },
      accessories: acc,
    };
  }
}

// ---------------------------------------------------------------- animation
function track(THREE, name, duration, N, fn, kind = 'q') {
  const times = Array.from({ length: N + 1 }, (_, i) => (i / N) * duration);
  const v = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const t of times) {
    const p = (t / duration) * Math.PI * 2;
    const r = fn(p);
    if (kind === 'q') { q.setFromEuler(e.set(r[0], r[1], r[2])); v.push(q.x, q.y, q.z, q.w); }
    else v.push(...r);
  }
  return kind === 'q'
    ? new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, v)
    : new THREE.VectorKeyframeTrack(`${name}.position`, times, v);
}

function armTrack(THREE, rig, side, dur, N, freeFn) {
  const s = side === 'L' ? 1 : -1;
  const item = rig.hands[side];
  if (item?.def.pose) {
    const { x = 0, z = 0 } = item.def.pose;
    return track(THREE, 'Arm' + side, dur, N, (p) => [x + Math.sin(p * 2) * 0.03, 0, z * -s]);
  }
  return track(THREE, 'Arm' + side, dur, N, (p) => freeFn(p, item?.def.swing ?? 1, s));
}

function walkClip(THREE, rig) {
  const { d, px } = rig, D = 1, N = 16, sin = Math.sin;
  const tracks = [
    track(THREE, 'Hips', D, N, (p) => [0, (d.legL + Math.abs(sin(p)) * 0.4) * px, 0], 'v'),
    track(THREE, 'Spine', D, N, (p) => [0.04, -sin(p) * 0.06, 0]),
    track(THREE, 'Neck', D, N, (p) => [-0.04 + Math.abs(sin(p)) * 0.05, sin(p) * 0.08, 0]),
    track(THREE, 'LegL', D, N, (p) => [-sin(p) * 0.6, 0, 0]),
    track(THREE, 'LegR', D, N, (p) => [sin(p) * 0.6, 0, 0]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.65 * sw, 0, 0.05 * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.65 * sw, 0, 0.05 * s]),
  ];
  for (const side of ['L', 'R']) {
    const it = rig.hands[side];
    if (it && !it.def.pose && rig.itemNodes[side]) tracks.push(track(THREE, 'Item' + side, D, N, (p) => [sin(p - 0.6) * 0.15 * (side === 'L' ? -1 : 1), 0, 0]));
  }
  return new THREE.AnimationClip('Walk', D, tracks);
}

function idleClip(THREE, rig) {
  const { d, px } = rig, D = 3, N = 24, sin = Math.sin;
  return new THREE.AnimationClip('Idle', D, [
    track(THREE, 'Hips', D, N, (p) => [0, (d.legL - Math.abs(sin(p)) * 0.12) * px, 0], 'v'),
    track(THREE, 'Spine', D, N, (p) => [sin(p * 2) * 0.012, 0, 0]),
    track(THREE, 'Neck', D, N, (p) => [0.02, sin(p) * 0.25, sin(p * 2) * 0.02]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.02]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.02]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.03, 0, (0.06 + sin(p * 2) * 0.015) * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.03, 0, (0.06 + sin(p * 2) * 0.015) * s]),
  ]);
}

function waveClip(THREE, rig) {
  const { d, px } = rig, D = 1.2, N = 24, sin = Math.sin;
  const side = rig.hands.R && !rig.hands.L ? 'L' : rig.hands.R ? null : 'R';
  const sg = side === 'L' ? 1 : -1;
  const wave = (s) => track(THREE, 'Arm' + s, D, N, (p) => [-0.2, 0, (2.5 + sin(p * 2) * 0.3) * (s === 'L' ? 1 : -1)]);
  const still = (s) => armTrack(THREE, rig, s, D, N, (p, sw, k) => [0, 0, 0.06 * k]);
  return new THREE.AnimationClip('Wave', D, [
    track(THREE, 'Hips', D, N, (p) => [0, (d.legL + Math.abs(sin(p)) * 0.1) * px, 0], 'v'),
    track(THREE, 'Spine', D, N, (p) => [0, 0, sin(p * 2) * 0.03 * sg]),
    track(THREE, 'Neck', D, N, (p) => [0.04, 0, 0.1 * sg + sin(p * 2) * 0.03]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.02]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.02]),
    side === 'L' ? wave('L') : still('L'),
    side === 'R' ? wave('R') : still('R'),
  ]);
}

function rideClip(THREE, rig, moving) {
  const { d, px, ride } = rig, D = 2, N = 24, sin = Math.sin;
  const hover = ride.def.hover;
  const bob = hover ? 0.7 : moving ? 0.08 : 0;
  const tracks = [
    track(THREE, 'Ride', D, N, (p) => [0, (hover ? 1.5 : 0) * px + sin(p * (hover ? 1 : 8)) * bob * px, 0], 'v'),
    track(THREE, 'Hips', D, N, (p) => [0, (d.legL * Math.cos(0.18) + 0.05 + Math.abs(sin(p * 2)) * 0.15) * px, 0], 'v'),
    track(THREE, 'Spine', D, N, (p) => [0.05, 0, (moving ? sin(p) * 0.05 : 0)]),
    track(THREE, 'Neck', D, N, (p) => [0, -1.15 + (moving ? 0 : sin(p) * 0.2), 0]),
    track(THREE, 'LegL', D, N, () => [0, 0, 0.18]),
    track(THREE, 'LegR', D, N, () => [0, 0, -0.18]),
    armTrack(THREE, rig, 'L', D, N, (p, sw, s) => [sin(p) * 0.1, 0, (0.45 + sin(p * 2) * 0.08) * s]),
    armTrack(THREE, rig, 'R', D, N, (p, sw, s) => [-sin(p) * 0.1, 0, (0.45 + sin(p * 2 + 1) * 0.08) * s]),
  ];
  if (hover) tracks.push(track(THREE, 'Board', D, N, (p) => [sin(p) * 0.03, 0, sin(p * 2) * 0.02]));
  return new THREE.AnimationClip(moving ? 'Ride' : 'Idle', D, tracks);
}
