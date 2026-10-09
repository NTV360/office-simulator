import { pick, random, rnd } from '../util';

// CharacterSpec: a plain, JSON-safe description of how a character looks. NPCs get a random one;
// the player's is chosen in character creation. The rig and parts turn a spec into meshes.
// No Three.js in here, so specs can be validated and saved anywhere.

export type HairStyle = 'short' | 'long' | 'bun' | 'buzz' | 'curly' | 'side' | 'bob';

export interface CharacterSpec {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  style: HairStyle;
  glasses: boolean;
  headphones: string | null;
  longSleeve: boolean;
  jacket: string | null;
  scale: number;
  /** Special looks (Hazel); never drawn for NPCs. */
  skirt: string | null;
  cube: boolean;
  angry: boolean;
}

export const PARTS = {
  skin: ['#f3cfb0', '#e5b48f', '#c98f66', '#a46c48', '#7e5135', '#f6dcc6', '#d9a27a'],
  hair: ['#1b1817', '#2b201b', '#46302a', '#5f4330', '#26252f', '#8a5a3b', '#a8a198', '#3b2a22'],
  shirt: ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'],
  pants: ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'],
  shoes: ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'],
  jacket: ['#2f3a45', '#6b5a4a', '#41505e', '#7d8a72'],
  headphones: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86'],
};
export const STYLE_OPTIONS: HairStyle[] = ['short', 'long', 'bun', 'buzz', 'curly', 'side', 'bob'];
const STYLE_WEIGHTED: HairStyle[] = ['short', 'long', 'bun', 'buzz', 'curly', 'side', 'short', 'long']; // what NPCs draw from
export const SCALE_RANGE: [number, number] = [.9, 1.1];

export const DEFAULT_SPEC: CharacterSpec = {
  skin: PARTS.skin[2], hair: PARTS.hair[1], style: 'short', shirt: PARTS.shirt[0], pants: PARTS.pants[0], shoes: PARTS.shoes[0],
  glasses: false, headphones: null, longSleeve: false, jacket: null, scale: 1,
  skirt: null, cube: false, angry: false,
};

// The order of these random draws is part of the recorded simulation; do not reorder.
export function randomSpec(role?: string): CharacterSpec {
  return {
    skin: pick(PARTS.skin), hair: pick(PARTS.hair), shirt: pick(PARTS.shirt), pants: pick(PARTS.pants), shoes: pick(PARTS.shoes), style: pick(STYLE_WEIGHTED),
    glasses: random() < .28, headphones: random() < (role === 'Developer' ? .3 : .1) ? pick(PARTS.headphones) : null,
    longSleeve: random() < .4, jacket: random() < .18 ? pick(PARTS.jacket) : null, scale: rnd(.93, 1.04),
    skirt: null, cube: false, angry: false,
  };
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Turn anything (a saved file, a half-edited form) into a complete, valid spec. */
export function normalizeSpec(input: unknown = {}): CharacterSpec {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SPEC;
  const color = (k: 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes'): string => (isHex(raw[k]) ? (raw[k] as string) : d[k]);
  const optColor = (k: 'headphones' | 'jacket' | 'skirt'): string | null => (isHex(raw[k]) ? (raw[k] as string) : null);
  return {
    skin: color('skin'), hair: color('hair'), shirt: color('shirt'), pants: color('pants'), shoes: color('shoes'),
    style: STYLE_OPTIONS.includes(raw.style as HairStyle) ? (raw.style as HairStyle) : d.style,
    glasses: !!raw.glasses, longSleeve: !!raw.longSleeve,
    headphones: optColor('headphones'), jacket: optColor('jacket'), skirt: optColor('skirt'),
    cube: !!raw.cube, angry: !!raw.angry,
    scale: typeof raw.scale === 'number' && Number.isFinite(raw.scale) ? Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], raw.scale)) : d.scale,
  };
}

/** A look a player may have: any valid spec, without the special looks that belong to Hazel (skirt, cube head, angry face). */
export function normalizePlayerSpec(input: unknown = {}): CharacterSpec {
  return { ...normalizeSpec(input), skirt: null, cube: false, angry: false };
}
