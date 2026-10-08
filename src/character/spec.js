import { pick, rnd } from '../core/util.js';

// CharacterSpec: a plain, JSON-safe description of how a character looks. NPCs get a random one;
// the player's is chosen in character creation. The rig and parts turn a spec into meshes.
// No Three.js in here, so specs can be validated and saved anywhere.

const PARTS = {
  skin: ['#f3cfb0', '#e5b48f', '#c98f66', '#a46c48', '#7e5135', '#f6dcc6', '#d9a27a'],
  hair: ['#1b1817', '#2b201b', '#46302a', '#5f4330', '#26252f', '#8a5a3b', '#a8a198', '#3b2a22'],
  shirt: ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'],
  pants: ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'],
  shoes: ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'],
  jacket: ['#2f3a45', '#6b5a4a', '#41505e', '#7d8a72'],
  headphones: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86'],
};
const STYLE_OPTIONS = ['short', 'long', 'bun', 'buzz', 'curly', 'side'];
const STYLE_WEIGHTED = ['short', 'long', 'bun', 'buzz', 'curly', 'side', 'short', 'long']; // what NPCs draw from
const SCALE_RANGE = [.9, 1.1];

const DEFAULT_SPEC = {
  skin: PARTS.skin[2], hair: PARTS.hair[1], style: 'short', shirt: PARTS.shirt[0], pants: PARTS.pants[0], shoes: PARTS.shoes[0],
  glasses: false, headphones: null, longSleeve: false, jacket: null, scale: 1,
};

function randomSpec(role) {
  return {
    skin: pick(PARTS.skin), hair: pick(PARTS.hair), shirt: pick(PARTS.shirt), pants: pick(PARTS.pants), shoes: pick(PARTS.shoes), style: pick(STYLE_WEIGHTED),
    glasses: Math.random() < .28, headphones: Math.random() < (role === 'Developer' ? .3 : .1) ? pick(PARTS.headphones) : null,
    longSleeve: Math.random() < .4, jacket: Math.random() < .18 ? pick(PARTS.jacket) : null, scale: rnd(.93, 1.04),
  };
}

const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Turn anything (a saved file, a half-edited form) into a complete, valid spec.
function normalizeSpec(raw = {}) {
  const d = DEFAULT_SPEC, color = (k, allowNull) => isHex(raw[k]) ? raw[k] : allowNull && raw[k] == null ? null : d[k];
  return {
    skin: color('skin'), hair: color('hair'), shirt: color('shirt'), pants: color('pants'), shoes: color('shoes'),
    style: STYLE_OPTIONS.includes(raw.style) ? raw.style : d.style,
    glasses: !!raw.glasses, longSleeve: !!raw.longSleeve,
    headphones: color('headphones', true), jacket: color('jacket', true),
    scale: Number.isFinite(raw.scale) ? Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], raw.scale)) : d.scale,
  };
}

export { DEFAULT_SPEC, PARTS, SCALE_RANGE, STYLE_OPTIONS, normalizeSpec, randomSpec };
