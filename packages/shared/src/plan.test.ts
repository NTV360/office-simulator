import { describe, expect, it } from 'vitest';
import { FULL_H, LOW_H, OUTER, OX, OY, S, W, WALLS, WALL_T, toPx, wx, wz } from './plan';
import { Vec3 } from './vec3';

describe('plan coordinates', () => {
  it('W gives the recorded floor position for the entrance (so a refactor cannot move it)', () => {
    const entry = W(223.5, 420);
    expect(entry).toBeInstanceOf(Vec3);
    expect(entry.x).toBeCloseTo(-7.1483500000000015, 12);
    expect(entry.y).toBe(0);
    expect(entry.z).toBeCloseTo(-6.439049999999998, 12);
  });

  it('puts the plan origin (OX, OY) at the world origin and scales by S', () => {
    expect(W(OX, OY)).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(wx(OX + 100)).toBeCloseTo(100 * S, 12);
    expect(wz(OY + 100)).toBeCloseTo(100 * S, 12);
  });

  it('toPx reverses W', () => {
    for (const [px, py] of [[223.5, 420], [113.5, 70.8], [667, 982], [682.2, 1113]]) {
      const [a, b] = toPx(W(px, py));
      expect(a).toBeCloseTo(px, 9);
      expect(b).toBeCloseTo(py, 9);
    }
  });

  it('each call to W returns a fresh point', () => {
    const a = W(10, 20), b = W(10, 20);
    expect(a).not.toBe(b);
    a.x = 5;
    expect(b.x).not.toBe(5);
  });
});

describe('the floor plan data', () => {
  it('has the recorded outline and walls', () => {
    expect(OUTER).toHaveLength(10);
    expect(WALLS).toHaveLength(20);
    expect(OUTER[0]).toEqual([113.5, 70.8]);
  });

  it('has only horizontal or vertical walls (the third-person camera collision relies on this)', () => {
    for (const [x1, y1, x2, y2] of WALLS) expect(x1 === x2 || y1 === y2).toBe(true);
  });

  it('has sensible wall dimensions', () => {
    expect(WALL_T).toBe(4.8);
    expect(FULL_H).toBe(2.7);
    expect(LOW_H).toBe(1.1);
    expect(LOW_H).toBeLessThan(FULL_H);
  });
});
