import { beforeAll, describe, expect, it } from 'vitest';
import { OX, OY, S, W, toPx } from '../plan';
import { Vec3 } from '../vec3';
import { stepPlayer } from '../sim/locomotion';
import { GC, GR, NAV, initGrid, walkPx } from './grid';
import { findPath } from './astar';

const count = () => NAV.reduce((a, v) => a + v, 0);
const px = (x: number, z: number) => new Vec3(x, 0, z);

describe('grid', () => {
  it('has fixed dimensions', () => { expect([GC, GR]).toEqual([129, 228]); });
  it('with no furniture, the open floor is the recorded size', () => {
    initGrid([]);
    expect(count()).toBe(OPEN_CELLS);
  });
  it('an obstacle removes the cells under it, plus a margin, and nothing else', () => {
    initGrid([]);
    const open = count();
    const [cx, cy] = [450, 600];
    expect(walkPx(cx, cy)).toBe(true);
    initGrid([[cx - 10, cy - 10, cx + 10, cy + 10]]);
    expect(walkPx(cx, cy)).toBe(false);
    expect(count()).toBeLessThan(open);
    expect(walkPx(cx + 60, cy + 60)).toBe(true);
  });
  it('is fully rebuilt each time (no stale obstacles)', () => {
    initGrid([[440, 590, 460, 610]]);
    initGrid([]);
    expect(count()).toBe(OPEN_CELLS);
  });
});

describe('findPath', () => {
  beforeAll(() => initGrid([]));
  it('goes straight in open floor: the only waypoint is the target (the start is not included)', () => {
    const a = W(450, 600), b = W(500, 640);
    const path = findPath(a, b)!;
    expect(path).toHaveLength(1);
    expect(path[0].x).toBeCloseTo(b.x, 9);
    expect(path[0].z).toBeCloseTo(b.z, 9);
  });
  it('bends around a wall: more than one waypoint, one of them past the wall end, every straight leg walkable', () => {
    initGrid([[480, 500, 520, 700]]);
    const a = W(400, 600), b = W(600, 600);
    const path = findPath(a, b)!;
    expect(path.length).toBeGreaterThan(1);
    const pts = [toPx(a), ...path.map(toPx)];
    expect(pts.some(([, y]) => y < 500 || y > 700)).toBe(true);
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k <= 20; k++) {
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 20, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 20;
      expect(walkPx(x, y)).toBe(true);
    }
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(b.x, 9);
    expect(last.z).toBeCloseTo(b.z, 9);
    initGrid([]);
  });
  it('returns null when a wall splits the floor in two and both ends are walkable', () => {
    initGrid([[0, 480, 1000, 520]]);
    expect(walkPx(450, 400)).toBe(true);
    expect(walkPx(450, 700)).toBe(true);
    expect(findPath(W(450, 400), W(450, 700))).toBeNull();
    initGrid([]);
  });
});

describe('stepPlayer', () => {
  beforeAll(() => initGrid([]));
  const walker = (x: number, z: number, state = 'idle') => ({ pos: { x, z }, state });
  it('moves freely on open floor and reports the distance', () => {
    const w = W(450, 600), p = walker(w.x, w.z);
    expect(stepPlayer(p, 0.3, 0.4, [p])).toBeCloseTo(0.5, 12);
  });
  it('slides along a blocked axis', () => {
    initGrid([[470, 560, 490, 640]]);
    const w = W(440, 600), p = walker(w.x, w.z);
    const x0 = p.pos.x, z0 = p.pos.z;
    const moved = stepPlayer(p, 1.5, 0.2, [p]);
    expect(p.pos.x).toBe(x0);
    expect(p.pos.z).toBeCloseTo(z0 + 0.2, 12);
    expect(moved).toBeCloseTo(0.2, 12);
    initGrid([]);
  });
  it('nudges out of another person but ignores people who are away', () => {
    const w = W(450, 600), a = walker(w.x, w.z), b = walker(w.x + 0.1, w.z);
    stepPlayer(a, 0, 0, [a, b]);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(0.41);
    const c = walker(w.x, w.z), d = walker(w.x + 0.1, w.z, 'away');
    stepPlayer(c, 0, 0, [c, d]);
    expect(c.pos.x).toBe(w.x);
  });
  it('does not push a person out of the walkable area', () => {
    const w = W(450, 600), p = walker(w.x, w.z), q = walker(w.x + 0.1, w.z);
    stepPlayer(p, 0, 0, [p, q]);
    expect(walkPx(p.pos.x / S + OX, p.pos.z / S + OY)).toBe(true);
  });
});
const OPEN_CELLS = 20647;
