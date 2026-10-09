import { ACCESSORIES as BLOCKY_ACC, BlockyCharacter, EYE_COLORS as BLOCKY_EYES, HAIR_COLORS as BLOCKY_HAIR, SKIN_TONES as BLOCKY_SKIN } from './pack/blocky-character.js';
import { PRESETS } from './pack/characters.js';
import { ACCESSORIES as CHIBI_ACC, ChibiCharacter, EYE_COLORS as CHIBI_EYES, HAIR_COLORS as CHIBI_HAIR, SKIN_TONES as CHIBI_SKIN } from './pack/chibi-character.js';

// CharacterSpec: a plain, JSON-safe description of how a character looks. It is the character pack's
// config (see pack/README.md): `type` picks the style ('chibi' or 'blocky'), the rest is body, hair,
// clothes and accessories. NPCs get a random one; the player's comes from the character lab.
// No Three.js in here (the pack's option lists are plain data), so specs can be validated and saved anywhere.

const TYPES = ['chibi', 'blocky'];
const CLASSES = { chibi: ChibiCharacter, blocky: BlockyCharacter };
const ACCESSORY_DEFS = { chibi: CHIBI_ACC, blocky: BLOCKY_ACC };
const PALETTES = {
  chibi: { skin: CHIBI_SKIN, hair: CHIBI_HAIR, eyes: CHIBI_EYES },
  blocky: { skin: BLOCKY_SKIN, hair: BLOCKY_HAIR, eyes: BLOCKY_EYES },
};
const PART_KEYS = ['hair', 'facialHair', 'top', 'bottom', 'shoes'];
const SLOTS_OFF = ['ride']; // skateboards and hoverboards: the office has no rides
const MAX_ACCESSORIES = 8;

// Office colours for generated NPCs (the pack's own palettes are used for skin, hair and eyes).
const OFFICE = {
  top: ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'],
  bottom: ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'],
  shoes: ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'],
  headphones: ['#2b3138', '#e9ecef', '#c45f4b', '#3a7f86'],
};

const DEFAULT_SPEC = {
  type: 'chibi', name: 'You', body: 'male', build: 'average', height: 'average', skin: '#e8b59a',
  eyes: { style: 'round', color: '#1b1514' }, cheeks: false, freckles: false,
  hair: { style: 'short', color: '#5b3a22' }, facialHair: { style: 'none' },
  top: { style: 'tshirt', color: '#3e6e9c' }, bottom: { style: 'pants', color: '#263240' },
  shoes: { style: 'sneakers', color: '#1b1b1b' }, accessories: [], angry: false,
};

const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// A colour may be a hex string or a palette name from either style ('brown', 'fair', ...).
function toHex(v) {
  if (isHex(v)) return v.toLowerCase();
  if (typeof v !== 'string') return null;
  for (const t of TYPES) for (const pal of Object.values(PALETTES[t])) if (isHex(pal[v])) return pal[v].toLowerCase();
  return null;
}
const union = list => [...new Set(list)];
function accessoryDef(name) { return CHIBI_ACC[name] ?? BLOCKY_ACC[name] ?? null; }
const officeAccessory = name => { const d = accessoryDef(name); return !!d && !SLOTS_OFF.includes(d.slot); };

// Everything the character lab can offer for one style. Accessory entries carry only plain data.
function specOptions(type) {
  const o = CLASSES[type].options;
  const accessories = Object.entries(ACCESSORY_DEFS[type]).filter(([, d]) => !SLOTS_OFF.includes(d.slot))
    .map(([name, d]) => ({ name, slot: d.slot, hand: d.hand ?? null, hat: !!d.hat, color: d.color ?? null }));
  return { ...o, eyes: o.eyes ?? null, accessories, palettes: PALETTES[type] };
}

// The pack's presets for both styles, without rides, ready to use as specs.
function presetList() {
  return TYPES.flatMap(type => Object.entries(PRESETS[type]).map(([key, p]) => ({ key, type, spec: normalizeSpec(p) })));
}

// Turn anything (a saved file, a half-edited form, a preset) into a complete, valid spec.
// Part styles from either style are kept: the pack swaps in the closest match when drawing.
function normalizeSpec(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SPEC, oc = CLASSES.chibi.options, ob = CLASSES.blocky.options;
  const type = TYPES.includes(r.type) ? r.type : d.type;
  const one = (v, list, fb) => list.includes(v) ? v : fb;
  const part = (key, fb) => {
    const v = typeof r[key] === 'string' ? { style: r[key] } : r[key] && typeof r[key] === 'object' ? r[key] : {};
    const out = { style: one(v.style, union([...oc[key], ...ob[key]]), fb.style) };
    const color = toHex(v.color) ?? (key === 'facialHair' ? null : fb.color);
    if (color) out.color = color;
    const accent = toHex(v.accent); if (accent) out.accent = accent;
    return out;
  };
  const eyesIn = typeof r.eyes === 'string' ? { color: r.eyes } : r.eyes && typeof r.eyes === 'object' ? r.eyes : {};
  const seen = new Set();
  const accessories = (Array.isArray(r.accessories) ? r.accessories : []).flatMap(a => {
    const v = typeof a === 'string' ? { type: a } : a && typeof a === 'object' ? a : {};
    if (!officeAccessory(v.type) || seen.has(v.type) || seen.size >= MAX_ACCESSORIES) return [];
    seen.add(v.type);
    const out = { type: v.type };
    const color = toHex(v.color); if (color) out.color = color;
    const accent = toHex(v.accent); if (accent) out.accent = accent;
    if (v.side === 'L' || v.side === 'R') out.side = v.side;
    return [out];
  });
  const spec = {
    type, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : d.name,
    body: one(r.body, oc.body, d.body), build: one(r.build, oc.build, d.build), height: one(r.height, oc.height, d.height),
    skin: toHex(r.skin) ?? d.skin,
    eyes: { style: one(eyesIn.style, oc.eyes, d.eyes.style), color: toHex(eyesIn.color) ?? d.eyes.color },
    cheeks: !!r.cheeks, freckles: !!r.freckles,
    hair: part('hair', d.hair), facialHair: part('facialHair', d.facialHair),
    top: part('top', d.top), bottom: part('bottom', d.bottom), shoes: part('shoes', d.shoes),
    accessories, angry: !!r.angry,
  };
  if (toHex(r.lips)) spec.lips = toHex(r.lips);
  if (spec.body === 'male' && spec.top.style === 'dress') spec.top.style = 'tshirt';
  return spec;
}

// ----- random NPCs: half from the pack's presets, half generated with office clothes -----
const HAIR_STYLES = {
  female: ['long', 'long', 'bob', 'bob', 'ponytail', 'bun', 'curly', 'afro', 'short', 'pigtails'],
  male: ['short', 'short', 'quiff', 'buzz', 'swept', 'spiky', 'curly', 'afro', 'none', 'mohawk'],
};
// `rand` is Math.random or a seeded generator (core/util.js seededRandom), so a look can be repeatable.
const picker = rand => ({ pick: a => a[Math.floor(rand() * a.length)], chance: p => rand() < p });

function generatedSpec(type, role, rand) {
  const { pick, chance } = picker(rand);
  const pal = PALETTES[type], body = chance(.5) ? 'female' : 'male', female = body === 'female';
  const hairColors = Object.values(pal.hair), natural = hairColors.slice(0, 9);
  const top = pick(female ? ['tshirt', 'polo', 'longsleeve', 'hoodie', 'jacket', 'sweater', 'dress', 'longsleeve'] : ['tshirt', 'polo', 'longsleeve', 'hoodie', 'jacket', 'sweater', 'polo']);
  const bottom = female && chance(.3) ? 'skirt' : pick(['pants', 'pants', 'jeans', 'jeans', 'joggers', chance(.2) ? 'shorts' : 'pants']);
  const acc = [];
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

// A random NPC look. Pass a seeded `rand` to get the same look every time (employees without a saved one).
function randomSpec(role, rand = Math.random) {
  const { pick, chance } = picker(rand), type = pick(TYPES);
  return normalizeSpec(chance(.5) ? pick(Object.values(PRESETS[type])) : generatedSpec(type, role, rand));
}

export { DEFAULT_SPEC, TYPES, normalizeSpec, presetList, randomSpec, specOptions };
