import { random } from '../util';
import pack from './pack-data.json';

// CharacterSpec: a plain, JSON-safe description of how a character looks. It is the character pack's config (see
// apps/client/src/character/pack/README.md): `type` picks the style ('chibi' or 'blocky'), the rest is body, hair, clothes and accessories.
// NPCs get a random one; a player's comes from the character lab. No Three.js in here: the pack's option lists, palettes, accessories and
// presets are plain data in `pack-data.json` (written by `npm run pack:dump` from the pack itself), so specs can be validated and made
// anywhere, including on the server. This is `main`'s `src/character/spec.js`.

export type StyleType = 'chibi' | 'blocky';

export interface PartSpec { style: string; color?: string; accent?: string }
export interface AccessorySpec { type: string; color?: string; accent?: string; side?: 'L' | 'R' }

export interface CharacterSpec {
  type: StyleType;
  name: string;
  body: string;
  build: string;
  height: string;
  skin: string;
  eyes: { style: string; color: string };
  cheeks: boolean;
  freckles: boolean;
  hair: PartSpec;
  facialHair: PartSpec;
  top: PartSpec;
  bottom: PartSpec;
  shoes: PartSpec;
  accessories: AccessorySpec[];
  /** A permanently furious face: Hazel's. Players cannot choose it. */
  angry: boolean;
  lips?: string;
}

interface StyleOptions {
  body: string[]; build: string[]; height: string[]; eyes?: string[]; hair: string[]; facialHair: string[]; top: string[]; bottom: string[]; shoes: string[]; accessories: string[];
}
interface AccessoryDef { slot: string; hand?: string; hat?: boolean; color?: string }
export interface Palettes { skin: Record<string, string>; hair: Record<string, string>; eyes: Record<string, string> }
interface PackData {
  options: Record<StyleType, StyleOptions>;
  palettes: Record<StyleType, Palettes>;
  accessories: Record<StyleType, Record<string, AccessoryDef>>;
  presets: Record<StyleType, Record<string, Record<string, unknown>>>;
}
const data = pack as unknown as PackData;

export const TYPES: readonly StyleType[] = ['chibi', 'blocky'];
const PART_KEYS = ['hair', 'facialHair', 'top', 'bottom', 'shoes'] as const;
/** Accessory slots the office has no use for (skateboards and hoverboards). */
const SLOTS_OFF = ['ride'];
/** The most accessories a look can carry (the lab stops offering more at this). */
export const MAX_ACCESSORIES = 8;

// Office colours for generated NPCs (the pack's own palettes are used for skin, hair and eyes).
const OFFICE = {
  top: ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'],
  bottom: ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'],
  shoes: ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'],
  headphones: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86'],
};

export const DEFAULT_SPEC: CharacterSpec = {
  type: 'chibi', name: 'You', body: 'male', build: 'average', height: 'average', skin: '#e8b59a',
  eyes: { style: 'round', color: '#1b1514' }, cheeks: false, freckles: false,
  hair: { style: 'short', color: '#5b3a22' }, facialHair: { style: 'none' },
  top: { style: 'tshirt', color: '#3e6e9c' }, bottom: { style: 'pants', color: '#263240' },
  shoes: { style: 'sneakers', color: '#1b1b1b' }, accessories: [], angry: false,
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
/** A colour may be a hex string or a palette name from either style ('brown', 'fair', ...). */
function toHex(v: unknown): string | null {
  if (isHex(v)) return v.toLowerCase();
  if (typeof v !== 'string') return null;
  for (const t of TYPES) for (const pal of Object.values(data.palettes[t])) { const c = own(pal, v); if (isHex(c)) return c.toLowerCase(); }
  return null;
}
const union = (list: string[]): string[] => [...new Set(list)];
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined); // (never "constructor" or "toString")
const accessoryDef = (name: unknown): AccessoryDef | null => (typeof name === 'string' ? own(data.accessories.chibi, name) ?? own(data.accessories.blocky, name) ?? null : null);
const officeAccessory = (name: unknown): boolean => { const d = accessoryDef(name); return !!d && !SLOTS_OFF.includes(d.slot); };

export interface AccessoryOption { name: string; slot: string; hand: string | null; hat: boolean; color: string | null }
/** Everything the character lab can offer for one style, as plain data. */
export interface SpecOptions {
  body: string[]; build: string[]; height: string[]; eyes: string[] | null; hair: string[]; facialHair: string[]; top: string[]; bottom: string[]; shoes: string[];
  accessories: AccessoryOption[];
  palettes: Palettes;
}

export function specOptions(type: StyleType): SpecOptions {
  const o = data.options[type];
  const accessories = Object.entries(data.accessories[type]).filter(([, d]) => !SLOTS_OFF.includes(d.slot))
    .map(([name, d]): AccessoryOption => ({ name, slot: d.slot, hand: d.hand ?? null, hat: !!d.hat, color: d.color ?? null }));
  return { body: o.body, build: o.build, height: o.height, eyes: o.eyes ?? null, hair: o.hair, facialHair: o.facialHair, top: o.top, bottom: o.bottom, shoes: o.shoes, accessories, palettes: data.palettes[type] };
}

/** The pack's presets for both styles, without rides, ready to use as specs. */
export function presetList(): Array<{ key: string; type: StyleType; spec: CharacterSpec }> {
  return TYPES.flatMap(type => Object.entries(data.presets[type]).map(([key, p]) => ({ key, type, spec: normalizeSpec(p) })));
}

type Raw = Record<string, unknown>;
const asObj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});

/**
 * Turn anything (a saved file, a half-edited form, a preset, a spec from the old look) into a complete, valid spec. Part styles from either
 * style are kept: the pack swaps in the closest match when drawing. Anything it does not know becomes the default.
 */
export function normalizeSpec(raw: unknown = {}): CharacterSpec {
  const r = asObj(raw);
  const d = DEFAULT_SPEC, oc = data.options.chibi, ob = data.options.blocky;
  const type: StyleType = TYPES.includes(r.type as StyleType) ? r.type as StyleType : d.type;
  const one = (v: unknown, list: readonly string[], fb: string): string => (typeof v === 'string' && list.includes(v) ? v : fb);
  const part = (key: typeof PART_KEYS[number], fb: PartSpec): PartSpec => {
    const v = typeof r[key] === 'string' ? { style: r[key] } : asObj(r[key]);
    const out: PartSpec = { style: one(v.style, union([...oc[key], ...ob[key]]), fb.style) };
    const color = toHex(v.color) ?? (key === 'facialHair' ? null : fb.color ?? null);
    if (color) out.color = color;
    const accent = toHex(v.accent); if (accent) out.accent = accent;
    return out;
  };
  const eyesIn = typeof r.eyes === 'string' ? { color: r.eyes } : asObj(r.eyes);
  const seen = new Set<string>();
  const accessories = (Array.isArray(r.accessories) ? r.accessories : []).flatMap((a: unknown): AccessorySpec[] => {
    const v = typeof a === 'string' ? { type: a } : asObj(a);
    const name = v.type;
    if (typeof name !== 'string' || !officeAccessory(name) || seen.has(name) || seen.size >= MAX_ACCESSORIES) return [];
    seen.add(name);
    const out: AccessorySpec = { type: name };
    const color = toHex(v.color); if (color) out.color = color;
    const accent = toHex(v.accent); if (accent) out.accent = accent;
    if (v.side === 'L' || v.side === 'R') out.side = v.side;
    return [out];
  });
  const spec: CharacterSpec = {
    type, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : d.name,
    body: one(r.body, oc.body, d.body), build: one(r.build, oc.build, d.build), height: one(r.height, oc.height, d.height),
    skin: toHex(r.skin) ?? d.skin,
    eyes: { style: one(eyesIn.style, oc.eyes ?? [], d.eyes.style), color: toHex(eyesIn.color) ?? d.eyes.color },
    cheeks: !!r.cheeks, freckles: !!r.freckles,
    hair: part('hair', d.hair), facialHair: part('facialHair', d.facialHair),
    top: part('top', d.top), bottom: part('bottom', d.bottom), shoes: part('shoes', d.shoes),
    accessories, angry: !!r.angry,
  };
  const lips = toHex(r.lips); if (lips) spec.lips = lips;
  if (spec.body === 'male' && spec.top.style === 'dress') spec.top.style = 'tshirt';
  return spec;
}

/** A look a player may have: any valid spec, without the permanently furious face that belongs to Hazel. */
export function normalizePlayerSpec(input: unknown = {}): CharacterSpec {
  return { ...normalizeSpec(input), angry: false };
}

// ----- random NPCs: half from the pack's presets, half generated with office clothes -----
const HAIR_STYLES = {
  female: ['long', 'long', 'bob', 'bob', 'ponytail', 'bun', 'curly', 'afro', 'short', 'pigtails'],
  male: ['short', 'short', 'quiff', 'buzz', 'swept', 'spiky', 'curly', 'afro', 'none', 'mohawk'],
};
// `rand` is the simulation's random stream or a seeded generator (seededRandom), so a look can be repeatable.
const picker = (rand: () => number) => ({ pick: <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)], chance: (p: number): boolean => rand() < p });

function generatedSpec(type: StyleType, role: string | undefined, rand: () => number): Raw {
  const { pick, chance } = picker(rand);
  const pal = data.palettes[type], body = chance(.5) ? 'female' : 'male', female = body === 'female';
  const hairColors = Object.values(pal.hair), natural = hairColors.slice(0, 9);
  const top = pick(female ? ['tshirt', 'polo', 'longsleeve', 'hoodie', 'jacket', 'sweater', 'dress', 'longsleeve'] : ['tshirt', 'polo', 'longsleeve', 'hoodie', 'jacket', 'sweater', 'polo']);
  const bottom = female && chance(.3) ? 'skirt' : pick(['pants', 'pants', 'jeans', 'jeans', 'joggers', chance(.2) ? 'shorts' : 'pants']);
  const acc: Array<string | AccessorySpec> = [];
  if (chance(.28)) acc.push('glasses');
  if (chance(role === 'Developer' ? .3 : .1)) acc.push({ type: 'headphones', color: pick(OFFICE.headphones) });
  if (chance(.2)) acc.push('watch');
  if (!female && top !== 'hoodie' && chance(role === 'Product Manager' ? .5 : .12)) acc.push('tie');
  if (chance(.06)) acc.push(pick(['cap', 'beanie', 'scarf', 'backpack']));
  if (chance(.25)) acc.push(pick(role === 'Product Manager' ? ['tablet', 'coffee', 'phone'] : ['coffee', 'coffee', 'phone', 'book', 'briefcase']));
  return {
    type, body, build: pick(['skinny', 'average', 'average', 'average', 'chubby']), height: pick(['short', 'average', 'average', 'tall']),
    skin: pick(Object.values(pal.skin)), cheeks: type === 'chibi' && female && chance(.7), freckles: type === 'blocky' && chance(.15),
    eyes: { style: pick(['round', 'round', 'round', 'big', 'dots']), color: pick(Object.values(pal.eyes)) },
    hair: { style: pick(HAIR_STYLES[body]), color: chance(.05) ? pick(hairColors) : pick(natural) },
    facialHair: { style: female ? 'none' : pick(['none', 'none', 'none', 'stubble', 'moustache', 'goatee', 'beard']) },
    top: { style: top, color: pick(OFFICE.top) }, bottom: { style: bottom, color: pick(OFFICE.bottom) },
    shoes: { style: pick(['simple', 'sneakers', 'sneakers', 'boots']), color: pick(OFFICE.shoes) },
    accessories: acc,
  };
}

/** A random NPC look. Pass a seeded `rand` to get the same look every time (employees without a saved one). */
export function randomSpec(role?: string, rand: () => number = random): CharacterSpec {
  const { pick, chance } = picker(rand), type = pick(TYPES);
  return normalizeSpec(chance(.5) ? pick(Object.values(data.presets[type])) : generatedSpec(type, role, rand));
}
