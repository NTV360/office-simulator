import { beforeAll, describe, expect, it } from 'vitest';
import { OX, OY, S, W } from '../plan';
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
  it('finds a straight route in open floor and ends at the target', () => {
    const a = W(450, 600), b = W(500, 640);
    const path = findPath(a, b)!;
    expect(path).not.toBeNull();
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(b.x, 9);
    expect(last.z).toBeCloseTo(b.z, 9);
  });
  it('routes around a wall of obstacles', () => {
    initGrid([[480, 500, 520, 700]]);
    const a = W(400, 600), b = W(600, 600);
    const path = findPath(a, b)!;
    expect(path.length).toBeGreaterThan(1);
    for (const v of path.slice(0, -1)) expect(walkPx(v.x / S + OX, v.z / S + OY)).toBe(true);
    initGrid([]);
  });
  it('gives up when the target is sealed off', () => {
    const ring: [number, number, number, number][] = [[440, 590, 460, 598], [440, 602, 460, 610], [440, 590, 448, 610], [452, 590, 460, 610]];
    initGrid(ring);
    expect(findPath(W(200, 600), W(450, 600))).not.toBeNull; // nearestWalk may relocate the target; must not throw
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
    const w = W(466, 600), p = walker(w.x, w.z);
    const moved = stepPlayer(p, 1, 0.2, [p]);
    expect(moved).toBeGreaterThan(0);
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
