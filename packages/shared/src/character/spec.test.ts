import { describe, expect, it } from 'vitest';
import { drawCount, seededRandom, setSeed } from '../util';
import { HAZEL_LOOK, applyHazel } from '../sim/hazel';
import { DEFAULT_SPEC, TYPES, normalizePlayerSpec, normalizeSpec, presetList, randomSpec, specOptions } from './spec';
import pack from './pack-data.json';

// The character look: the pack's config, validated without Three.js.

const HEX = /^#[0-9a-f]{6}$/i;

describe('the pack data', () => {
  it('is what the vendored pack says (run `npm run pack:dump` after updating the pack)', async () => {
    // @ts-expect-error (a plain script, not part of the typed code)
    const { readPack } = await import('../../../../scripts/dump-pack.mjs');
    expect(JSON.parse(JSON.stringify(await readPack()))).toEqual(JSON.parse(JSON.stringify(pack)));
  });
  it('the dump found the pack\'s real tables (so a dump that finds nothing cannot pass)', () => {
    for (const t of TYPES) {
      expect(Object.keys(pack.accessories[t]).length).toBeGreaterThan(15);
      expect(Object.keys(pack.accessories[t])).toEqual(expect.arrayContaining(['glasses', 'headphones', 'watch', 'coffee']));
      expect(pack.options[t].hair.length).toBeGreaterThan(8);
      expect(Object.keys(pack.palettes[t].skin).length).toBeGreaterThan(5);
    }
  });
  it('has the two styles, 50 presets and every palette colour is a hex', () => {
    expect([...TYPES]).toEqual(['chibi', 'blocky']);
    expect(Object.keys(pack.presets.chibi)).toHaveLength(25);
    expect(Object.keys(pack.presets.blocky)).toHaveLength(25);
    for (const t of TYPES) for (const pal of Object.values(pack.palettes[t])) for (const c of Object.values(pal as Record<string, string>)) expect(c).toMatch(HEX);
  });
});

describe('presets', () => {
  it('every one of the 50 normalizes to a valid spec of its own style that stays the same when normalized again', () => {
    const list = presetList();
    expect(list).toHaveLength(50);
    for (const { key, type, spec } of list) {
      expect(spec.type, key).toBe(type);
      expect(normalizeSpec(spec), key).toEqual(spec);
      expect(spec.accessories.every(a => a.type !== 'skateboard' && a.type !== 'hoverboard'), key).toBe(true); // no rides in an office
    }
  });
});

describe('randomSpec', () => {
  it('is repeatable for a seed and uses the simulation stream', () => {
    setSeed(1);
    const d0 = drawCount();
    const a = randomSpec('Developer');
    expect(drawCount() - d0).toBeGreaterThan(0);
    setSeed(1);
    expect(randomSpec('Developer')).toEqual(a);
  });
  it('gives the same look every time for the same id, without touching the simulation stream', () => {
    setSeed(1);
    const d0 = drawCount();
    const a = randomSpec('Designer', seededRandom('6f1a-employee-id')), b = randomSpec('Designer', seededRandom('6f1a-employee-id')), c = randomSpec('Designer', seededRandom('another-id'));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect(drawCount()).toBe(d0);
  });
  it('always produces a spec that normalizes to itself, in both styles, with both bodies', () => {
    setSeed(5);
    const seen = { types: new Set<string>(), bodies: new Set<string>() };
    for (let i = 0; i < 200; i++) { const s = randomSpec(['Developer', 'Product Manager', 'Support'][i % 3]); expect(normalizeSpec(s)).toEqual(s); seen.types.add(s.type); seen.bodies.add(s.body); }
    expect([...seen.types].sort()).toEqual(['blocky', 'chibi']);
    expect([...seen.bodies].sort()).toEqual(['female', 'male']);
  });
});

describe('normalizeSpec', () => {
  it('fills an empty input with the default', () => {
    expect(normalizeSpec({})).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec()).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec(null)).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec('nonsense')).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec([1, 2])).toEqual(DEFAULT_SPEC);
  });
  it('a look from before the character pack (skin, shirt, style...) becomes a valid one, keeping what it can', () => {
    const old = { skin: '#c98f66', hair: '#2b201b', shirt: '#c45f4b', pants: '#263240', shoes: '#1b1b1b', style: 'bun', glasses: true, scale: 1.05 };
    const s = normalizeSpec(old);
    expect(s.skin).toBe('#c98f66');
    expect(s.type).toBe('chibi');
    expect(normalizeSpec(s)).toEqual(s);
  });
  it('rejects bad colours, styles, sizes and parts', () => {
    const s = normalizeSpec({ skin: 'red', body: 'robot', build: 'huge', height: 'giant', hair: { style: 'wizard', color: 'nope' }, top: 5, eyes: { style: 'laser', color: 12 }, type: 'voxel' });
    expect(s.skin).toBe(DEFAULT_SPEC.skin);
    expect(s.body).toBe('male'); expect(s.build).toBe('average'); expect(s.height).toBe('average');
    expect(s.hair).toEqual(DEFAULT_SPEC.hair); expect(s.top).toEqual(DEFAULT_SPEC.top);
    expect(s.eyes).toEqual(DEFAULT_SPEC.eyes);
    expect(s.type).toBe('chibi');
  });
  it('accepts colours as hex or as the pack\'s names, and a part as just its style', () => {
    const s = normalizeSpec({ skin: 'brown', hair: 'bob', eyes: 'olive', top: { style: 'hoodie', color: '#ABCDEF', accent: 'fair' } });
    expect(s.skin).toMatch(HEX); expect(s.skin).not.toBe(DEFAULT_SPEC.skin);
    expect(s.hair.style).toBe('bob');
    expect(s.eyes.color).toMatch(HEX);
    expect(s.top).toMatchObject({ style: 'hoodie', color: '#abcdef' });
    expect(s.top.accent).toMatch(HEX);
  });
  it('accessories: only known ones, once each, no rides, at most eight, with valid colours and sides', () => {
    const s = normalizeSpec({ accessories: ['glasses', 'glasses', 'skateboard', 'hoverboard', 'nonsense', { type: 'watch', color: 'bad', side: 'X' }, { type: 'coffee', color: '#112233', side: 'L' }, 7, null] });
    expect(s.accessories).toEqual([{ type: 'glasses' }, { type: 'watch' }, { type: 'coffee', color: '#112233', side: 'L' }]);
    const many = normalizeSpec({ accessories: Object.keys(pack.accessories.chibi).filter(k => pack.accessories.chibi[k as keyof typeof pack.accessories.chibi].slot !== 'ride') });
    expect(many.accessories.length).toBeLessThanOrEqual(8);
  });
  it('an accessory is only ever one of the pack\'s own: names inherited from Object (constructor, toString, __proto__...) are dropped', () => {
    const s = normalizeSpec({ accessories: ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf', { type: 'constructor' }, 'glasses'] });
    expect(s.accessories).toEqual([{ type: 'glasses' }]);
    expect(normalizeSpec({ skin: 'constructor', hair: { style: 'toString', color: '__proto__' } }).skin).toBe(DEFAULT_SPEC.skin);
  });
  it('a man in a dress is in a t-shirt', () => {
    expect(normalizeSpec({ body: 'male', top: { style: 'dress' } }).top.style).toBe('tshirt');
    expect(normalizeSpec({ body: 'female', top: { style: 'dress' } }).top.style).toBe('dress');
  });
  it('the name is trimmed and cut to 40 characters', () => {
    expect(normalizeSpec({ name: '  Ana  ' }).name).toBe('Ana');
    expect(normalizeSpec({ name: 'x'.repeat(100) }).name).toHaveLength(40);
    expect(normalizeSpec({ name: '   ' }).name).toBe(DEFAULT_SPEC.name);
  });
  it('a hostile object does no harm (proto pollution, huge lists)', () => {
    const s = normalizeSpec(JSON.parse('{"__proto__":{"polluted":true},"hair":{"__proto__":{"x":1},"style":"bun"},"accessories":' + JSON.stringify(Array(5000).fill('watch')) + '}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s.hair.style).toBe('bun');
    expect(s.accessories).toEqual([{ type: 'watch' }]);
  });
});

describe('a player\'s look', () => {
  it('can never be the furious face that belongs to Hazel', () => {
    expect(normalizeSpec({ angry: true }).angry).toBe(true);
    expect(normalizePlayerSpec({ angry: true }).angry).toBe(false);
  });
});

describe('Hazel', () => {
  it('is a short blocky character with a bob, a skirt and a furious face', () => {
    const h = applyHazel();
    expect(h).toMatchObject({ first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer' });
    expect(h.spec).toMatchObject({ type: 'blocky', body: 'female', height: 'short', angry: true, hair: { style: 'bob' }, bottom: { style: 'skirt' } });
    expect(normalizeSpec(HAZEL_LOOK)).toEqual(h.spec);
  });
});

describe('what the lab can offer', () => {
  it('each style lists its own options, and no rides', () => {
    for (const t of TYPES) {
      const o = specOptions(t);
      expect(o.hair.length).toBeGreaterThan(8);
      expect(o.accessories.every(a => a.slot !== 'ride')).toBe(true);
      expect(Object.keys(o.palettes.skin).length).toBeGreaterThan(5);
    }
    expect(specOptions('chibi').eyes).not.toBeNull();
    expect(specOptions('blocky').eyes).toBeNull(); // (blocky uses the colour only)
  });
});
