import { describe, expect, it } from 'vitest';
import { loadLayout, objects, officeLayout } from '../index';
import { THROW, throwPath, throwVelocity } from './throw';

// Throwing by the shared rules: how fast it leaves the hand, which way, and where it comes down (the page draws this path while you aim).

loadLayout(officeLayout);
const of = (t: string) => objects.all().find(o => o.type === t)!;
const landing = (type: string, power: number, pitch: number) => {
  const path = throwPath(of(type), { x: 0, y: 1.1, z: 0 }, throwVelocity(of(type), power, 0, pitch));
  const end = path[path.length - 1], top = Math.max(...path.map(q => q.y));
  return { far: Math.hypot(end.x, end.z), top, end };
};

describe('throwing', () => {
  it('a chair thrown hard, looking up a little, goes in a long arc: from one end of the office to the other (table A to table E is about 13 m)', () => {
    const { far, top, end } = landing('chair-wood', 1, .5);
    expect(end.y).toBe(0);
    expect(far).toBeGreaterThan(12); expect(far).toBeLessThan(18);
    expect(top).toBeGreaterThan(1.8); // (an arc: well above where it left the hands)
  });

  it('looking level throws it straight and low; looking up lobs it high', () => {
    const level = landing('chair-wood', 1, 0), lob = landing('chair-wood', 1, .9);
    expect(level.top).toBeLessThan(2.2); // (it leaves a little above where you look, so it is not flat, but it does not climb)
    expect(lob.top).toBeGreaterThan(level.top + 1);
  });

  it('harder goes further; a mug flies much further and faster than a chair, but no faster than an arm swings', () => {
    expect(landing('chair-wood', 1, .5).far).toBeGreaterThan(landing('chair-wood', .3, .5).far + 1);
    const mug = throwVelocity(of('mug'), 1, 0, 0), chair = throwVelocity(of('chair-wood'), 1, 0, 0);
    expect(Math.hypot(mug.vx, mug.vy, mug.vz)).toBeCloseTo(THROW.fastest, 3);
    expect(Math.hypot(chair.vx, chair.vy, chair.vz)).toBeLessThan(14);
    expect(landing('mug', 1, .5).far).toBeGreaterThan(landing('chair-wood', 1, .5).far * 1.5);
  });

  it('goes the way you look', () => {
    const v = throwVelocity(of('mug'), 1, Math.PI / 2, 0);
    expect(v.vx).toBeGreaterThan(10); expect(Math.abs(v.vz)).toBeLessThan(1e-6);
  });

  it('nonsense in (not a number) throws gently forward instead of breaking', () => {
    const v = throwVelocity(of('mug'), NaN, NaN, NaN);
    expect([v.vx, v.vy, v.vz].every(Number.isFinite)).toBe(true);
  });
});
