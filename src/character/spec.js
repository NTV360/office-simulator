import { pick, rnd } from '../core/util.js';

// CharacterSpec: a plain, JSON-safe description of how a character looks. NPCs get a random one;
// the player's is chosen in character creation. The rig and parts turn a spec into meshes.
// No Three.js in here, so specs can be validated and saved anywhere.
//
// A spec has two kinds of field. Body parts (skin, hair, eyes, top, legs, shoes, height) always apply.
// Accessories (glasses, hat, scarf, ...) are extras on top and are all off by default.

const PARTS = {
  skin: ['#f3cfb0', '#e5b48f', '#c98f66', '#a46c48', '#7e5135', '#f6dcc6', '#d9a27a'],
  hair: ['#1b1817', '#2b201b', '#46302a', '#5f4330', '#26252f', '#8a5a3b', '#a8a198', '#3b2a22'],
  shirt: ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'],
  pants: ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'],
  shoes: ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'],
  jacket: ['#2f3a45', '#6b5a4a', '#41505e', '#7d8a72'],
  headphones: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86'],
};
// What character creation offers: the NPC colors above, then more. NPCs keep drawing from PARTS only.
const CREATOR_COLORS = {
  skin: [...PARTS.skin, '#f9bf95', '#ab633b', '#75412b', '#59352b'],
  hair: [...PARTS.hair, '#c4824e', '#f7d84a', '#ffffff', '#ac3232', '#e07ab0', '#5b6ee1', '#5aa0ff'],
  eyes: ['#1b1f24', '#46302a', '#6a4a30', '#2f6f9a', '#5f8f6e', '#7a6aa3'],
  shirt: [...PARTS.shirt, '#ac3232', '#222034', '#99e550', '#b46ed5'],
  pants: [...PARTS.pants, '#222034', '#5b6ee1', '#9badb7', '#ac3232'],
  shoes: [...PARTS.shoes, '#222034', '#ac3232', '#5b6ee1'],
  jacket: [...PARTS.jacket, '#222034', '#9b4d62', '#3e6e9c'],
  accent: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86', '#e2b65c', '#7a6aa3', '#5b82e0', '#a82828', '#f4c430', '#e07ab0'], // every other accessory
};
// Style order is the order the creator lists them in.
const STYLE_OPTIONS = ['short', 'buzz', 'side', 'long', 'bob', 'bun', 'pigtails', 'braid', 'curly', 'afro', 'spiky', 'bald'];
const STYLE_WEIGHTED = ['short', 'long', 'bun', 'buzz', 'curly', 'side', 'short', 'long']; // what NPCs draw from
const HAT_OPTIONS = ['pilot', 'grad', 'beanie', 'hood'];
const COSTUME_OPTIONS = ['vampire', 'snowman', 'frank', 'wolf', 'ghost'];
const SCALE_RANGE = [.9, 1.1];

const DEFAULT_SPEC = {
  skin: PARTS.skin[2], hair: PARTS.hair[1], style: 'short', eyes: '#1b1f24', shirt: PARTS.shirt[0], pants: PARTS.pants[0], shoes: PARTS.shoes[0],
  longSleeve: false, shorts: false, scale: 1,
  glasses: false, headphones: null, jacket: null,
  hat: null, hatColor: '#5b82e0', hatBand: '#e8eef8', goggles: null, gogglesLens: '#2f6f9a', earrings: null, scarf: null, tie: null, costume: null,
  skirt: null, cube: false, angry: false, // special looks (Hazel); not drawn for NPCs
};

function randomSpec(role) {
  return {
    ...DEFAULT_SPEC,
    skin: pick(PARTS.skin), hair: pick(PARTS.hair), shirt: pick(PARTS.shirt), pants: pick(PARTS.pants), shoes: pick(PARTS.shoes), style: pick(STYLE_WEIGHTED),
    glasses: Math.random() < .28, headphones: Math.random() < (role === 'Developer' ? .3 : .1) ? pick(PARTS.headphones) : null,
    longSleeve: Math.random() < .4, jacket: Math.random() < .18 ? pick(PARTS.jacket) : null, scale: rnd(.93, 1.04),
  };
}

// A random look for character creation, drawn from everything the creator offers. Keeps the player's height.
function randomPlayerSpec(current) {
  const C = CREATOR_COLORS, maybe = (chance, v) => Math.random() < chance ? v : null;
  return normalizeSpec({
    skin: pick(C.skin), hair: pick(C.hair), eyes: pick(C.eyes), style: pick(STYLE_OPTIONS), shirt: pick(C.shirt), pants: pick(C.pants), shoes: pick(C.shoes),
    longSleeve: Math.random() < .4, shorts: Math.random() < .2, glasses: Math.random() < .25,
    headphones: maybe(.12, pick(C.accent)), jacket: maybe(.15, pick(C.jacket)),
    hat: maybe(.15, pick(HAT_OPTIONS)), hatColor: pick(C.accent), goggles: maybe(.07, pick(C.accent)), earrings: maybe(.15, pick(C.accent)),
    scarf: maybe(.12, pick(C.accent)), tie: maybe(.1, pick(C.accent)), costume: maybe(.05, pick(COSTUME_OPTIONS)),
    scale: current ? current.scale : 1,
  });
}

const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Turn anything (a saved file, a half-edited form) into a complete, valid spec.
function normalizeSpec(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SPEC, color = (k, allowNull) => isHex(raw[k]) ? raw[k] : allowNull && raw[k] == null ? null : d[k];
  return {
    skin: color('skin'), hair: color('hair'), eyes: color('eyes'), shirt: color('shirt'), pants: color('pants'), shoes: color('shoes'),
    style: STYLE_OPTIONS.includes(raw.style) ? raw.style : d.style,
    longSleeve: !!raw.longSleeve, shorts: !!raw.shorts,
    glasses: !!raw.glasses, headphones: color('headphones', true), jacket: color('jacket', true),
    hat: HAT_OPTIONS.includes(raw.hat) ? raw.hat : null, hatColor: color('hatColor'), hatBand: color('hatBand'),
    goggles: color('goggles', true), gogglesLens: color('gogglesLens'),
    earrings: color('earrings', true), scarf: color('scarf', true), tie: color('tie', true),
    costume: COSTUME_OPTIONS.includes(raw.costume) ? raw.costume : null,
    skirt: color('skirt', true), cube: !!raw.cube, angry: !!raw.angry,
    scale: Number.isFinite(raw.scale) ? Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], raw.scale)) : d.scale,
  };
}

// Do two normalized specs look the same, apart from height?
function sameLook(a, b) { return Object.keys(b).every(k => k === 'scale' || a[k] === b[k]); }

export { COSTUME_OPTIONS, CREATOR_COLORS, DEFAULT_SPEC, HAT_OPTIONS, PARTS, SCALE_RANGE, STYLE_OPTIONS, normalizeSpec, randomPlayerSpec, randomSpec, sameLook };
