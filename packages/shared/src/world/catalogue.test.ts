import { describe, expect, it } from 'vitest';
import { CARRY_LIMITS, CATALOGUE, carryOf, type Collider, type Triple } from './catalogue';
import { MATERIALS, frictionBetween, slipAngle } from './materials';

const deg = (r: number) => r * 180 / Math.PI;

// The lowest point of a shape, in the item's own frame (for a box, its eight corners turned by its rotation).
function bottomOf(c: Collider): number {
  if (c.shape === 'sphere') return c.at[1] - c.radius;
  if (c.shape === 'cylinder') return c.at[1] - c.height / 2;
  const [rx, ry, rz] = c.rot ?? [0, 0, 0], [w, h, d] = c.size.map(s => s / 2) as unknown as Triple;
  let low = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let x = sx * w, y = sy * h, z = sz * d;
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    low = Math.min(low, y);
  }
  return c.at[1] + low;
}

describe('every kind of item', () => {
  it('has a real mass in kg, a known material and at least one shape of a real size', () => {
    for (const [type, t] of Object.entries(CATALOGUE)) {
      if (t.mobility === 'movable') expect(t.mass, type).toBeGreaterThan(0);
      expect(MATERIALS[t.material], type).toBeDefined();
      expect(t.colliders.length, type).toBeGreaterThan(0);
      for (const c of t.colliders) {
        if (c.material) expect(MATERIALS[c.material], type).toBeDefined();
        const sizes = c.shape === 'box' ? [...c.size] : c.shape === 'cylinder' ? [c.radius, c.height] : [c.radius];
        for (const s of sizes) expect(s, type).toBeGreaterThan(0);
      }
    }
  });
  it('stands on its origin: the lowest point of its shapes is the floor or table it rests on, so it neither floats nor sinks', () => {
    for (const [type, t] of Object.entries(CATALOGUE)) expect(Math.min(...t.colliders.map(bottomOf)), type).toBeCloseTo(0, 3);
  });
  it('has the masses the plan settled on (typical real-world weights)', () => {
    const mass = Object.fromEntries(Object.entries(CATALOGUE).map(([k, t]) => [k, t.mass]));
    expect(mass).toMatchObject({ 'chair-office': 12, 'chair-wood': 6, 'stool-bar': 8, mug: .35, notebook: .35, 'plant-desk': .8, monitor: 4.5, keyboard: .5, mouse: .09 });
  });
  it('seats and notebooks take things on top; mugs and plants do not', () => {
    expect(['chair-office', 'chair-wood', 'stool-bar', 'notebook'].every(k => CATALOGUE[k].surface)).toBe(true);
    expect(CATALOGUE.mug.surface || CATALOGUE['plant-desk'].surface).toBe(false);
  });
});

describe('how a person carries it', () => {
  it('follows from the mass: small things in one hand, chairs in two', () => {
    expect(['mug', 'notebook', 'plant-desk'].map(carryOf)).toEqual(['one-hand', 'one-hand', 'one-hand']);
    expect(['chair-office', 'chair-wood', 'stool-bar'].map(carryOf)).toEqual(['two-hands', 'two-hands', 'two-hands']);
    expect(carryOf('sofa')).toBeUndefined(); // (not a kind yet)
  });
  it('agrees with the limits for every kind', () => {
    for (const [type, t] of Object.entries(CATALOGUE)) {
      const want = t.mobility === 'fixed' ? 'fixed' : t.mass <= CARRY_LIMITS.oneHand ? 'one-hand' : t.mass <= CARRY_LIMITS.twoHands ? 'two-hands' : 'drag';
      expect(carryOf(type), type).toBe(want);
    }
  });
});

describe('materials', () => {
  it('average their friction when they touch', () => {
    expect(frictionBetween('ceramic', 'fabric')).toBeCloseTo(.575);
    expect(frictionBetween('glass', 'rubber')).toBeGreaterThan(frictionBetween('glass', 'glass'));
  });
  it('a mug holds on a tilted seat until about 30°, on a wood desk until about 25°', () => {
    expect(deg(slipAngle('ceramic', 'fabric'))).toBeCloseTo(29.9, 0);
    expect(deg(slipAngle('ceramic', 'wood'))).toBeCloseTo(25.4, 0);
  });
});
