import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAU, angDiff, drawCount, pick, random, rnd, setSeed, shuffle, vpick, vrandom, vrnd } from './util';

const nativeRandom = Math.random; // before any test replaces it

afterEach(() => { vi.restoreAllMocks(); setSeed(null); });

describe('the seeded simulation stream', () => {
  it('produces the recorded sequence for a seed (so a refactor cannot change it)', () => {
    setSeed(1);
    const got = [random(), random(), random(), random()];
    const want = [0.6270739406, 0.0027357212, 0.5274470400, 0.9810509675];
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });

  it('repeats for the same seed and differs for another', () => {
    setSeed(7); const a = [random(), random(), random()];
    setSeed(7); const b = [random(), random(), random()];
    setSeed(8); const c = [random(), random(), random()];
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('keeps every value in [0, 1)', () => {
    setSeed(3);
    for (let i = 0; i < 10000; i++) { const v = random(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('goes back to Math.random when the seed is cleared', () => {
    setSeed(5);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    setSeed(null);
    expect(random()).toBe(0.25);
  });
});

describe('rnd, pick and shuffle', () => {
  it('give the recorded results for seed 42 (so a refactor cannot change them)', () => {
    setSeed(42);
    expect(pick(['a', 'b', 'c', 'd', 'e'])).toBe('d');
    expect(shuffle([1, 2, 3, 4, 5])).toEqual([2, 1, 5, 4, 3]);
    expect(rnd(10, 20)).toBeCloseTo(15.265925, 6);
  });

  it('rnd stays inside its range', () => {
    setSeed(9);
    for (let i = 0; i < 2000; i++) { const v = rnd(-3, 5); expect(v).toBeGreaterThanOrEqual(-3); expect(v).toBeLessThan(5); }
  });

  it('pick only returns elements of the array', () => {
    setSeed(9);
    const items = ['x', 'y', 'z'];
    for (let i = 0; i < 200; i++) expect(items).toContain(pick(items));
  });

  it('shuffle works in place, returns the same array, and keeps every element', () => {
    setSeed(11);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = shuffle(arr);
    expect(out).toBe(arr);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('the draw counter', () => {
  it('counts one per random, rnd and pick, and n-1 per shuffle of n', () => {
    setSeed(1);
    const start = drawCount();
    random(); rnd(0, 1); pick([1, 2, 3]);
    expect(drawCount() - start).toBe(3);
    shuffle([1, 2, 3, 4, 5]);
    expect(drawCount() - start).toBe(3 + 4);
  });
});

describe('the visual stream', () => {
  it('never touches the seeded stream or the draw counter', () => {
    setSeed(7); const first = random();
    setSeed(7);
    const before = drawCount();
    vrandom(); vrnd(0, 1); vpick([1, 2, 3]);
    expect(drawCount()).toBe(before);
    expect(random()).toBe(first); // the same next value as if the visual draws never happened
  });

  it('is the platform Math.random, and seeding does not affect it', () => {
    expect(vrandom).toBe(nativeRandom); // captured when the module loaded, as in the original code
    setSeed(1); const first = vrandom();
    setSeed(1); const second = vrandom();
    expect(first).not.toBe(second); // a seeded stream would repeat here
    for (let i = 0; i < 500; i++) { const v = vrnd(10, 20); expect(v).toBeGreaterThanOrEqual(10); expect(v).toBeLessThan(20); }
    expect(['a', 'b']).toContain(vpick(['a', 'b']));
  });
});

describe('angDiff', () => {
  it('is the shortest signed turn', () => {
    expect(angDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(angDiff(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(angDiff(1, 1)).toBe(0);
  });

  it('wraps around instead of taking the long way', () => {
    expect(angDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(angDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
  });

  it('knows a full turn is no turn', () => {
    expect(angDiff(0.3, 0.3 + TAU)).toBeCloseTo(0, 12);
    expect(TAU).toBeCloseTo(6.283185307179586, 12);
  });
});
