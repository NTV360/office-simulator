import { describe, expect, it } from 'vitest';
import { drawCount, setSeed } from '../util';
import { DEFAULT_SPEC, PARTS, STYLE_OPTIONS, normalizeSpec, randomSpec } from './spec';

const HEX = /^#[0-9a-f]{6}$/i;

describe('PARTS', () => {
  it('are all valid hex colours', () => {
    for (const list of Object.values(PARTS)) for (const c of list) expect(c).toMatch(HEX);
  });
});

describe('randomSpec', () => {
  it('is repeatable for a seed and matches the recorded values', () => {
    setSeed(1);
    const d0 = drawCount();
    const a = randomSpec('Developer');
    expect(drawCount() - d0).toBeGreaterThan(0);
    expect(a).toMatchObject({ skin: '#7e5135', hair: '#1b1817', shirt: '#f4f3ef', pants: '#30363c', shoes: '#9a8c7a', style: 'bun', glasses: false, headphones: null, longSleeve: false, jacket: null, skirt: null, cube: false, angry: false });
    expect(a.scale).toBeCloseTo(0.9800798239884898, 12);
    setSeed(1);
    expect(randomSpec('Developer')).toEqual(a);
  });
  it('consumes the recorded number of draws for four people', () => {
    setSeed(1);
    const d0 = drawCount();
    ['Developer', 'Designer', 'Support', 'Developer'].forEach(r => randomSpec(r));
    expect(drawCount() - d0).toBe(45);
  });
  it('always produces a spec that normalizes to itself', () => {
    setSeed(5);
    for (let i = 0; i < 50; i++) { const s = randomSpec('Support'); expect(normalizeSpec(s)).toEqual(s); }
  });
});

describe('normalizeSpec', () => {
  it('fills an empty input with the default', () => {
    expect(normalizeSpec({})).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec()).toEqual(DEFAULT_SPEC);
    expect(normalizeSpec(null)).toEqual(DEFAULT_SPEC);
  });
  it('rejects bad colours, styles and scales', () => {
    const s = normalizeSpec({ skin: 'red', style: 'mohawk', scale: 99, headphones: 12, jacket: '#123456' });
    expect(s.skin).toBe(DEFAULT_SPEC.skin);
    expect(s.style).toBe('short');
    expect(s.scale).toBe(1.1);
    expect(s.headphones).toBeNull();
    expect(s.jacket).toBe('#123456');
    expect(normalizeSpec({ scale: NaN }).scale).toBe(1);
    expect(normalizeSpec({ scale: 0.1 }).scale).toBe(0.9);
  });
  it('accepts every listed style', () => {
    for (const style of STYLE_OPTIONS) expect(normalizeSpec({ style }).style).toBe(style);
  });
});
