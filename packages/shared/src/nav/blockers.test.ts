import { beforeEach, describe, expect, it } from 'vitest';
import { officeLayout } from '../layout/office';
import { OX, OY, S } from '../plan';
import { initState, resetSim } from '../sim/state';
import { stepPerson } from '../sim/step';
import type { Person } from '../sim/types';
import { Vec3 } from '../vec3';
import { findPath } from './astar';
import { NAV, initGrid, navVersion, setBlocker, walkPx, type ObstacleRect } from './grid';

// Things that block walking and can move (a table, a sofa): they block exactly what the same rectangle would as fixed furniture, they
// give the floor back when they go, and people walking re-plan a route that a moved one now blocks. See docs/ITEMS-PHYSICS-PLAN.md, step 4.

const obstacles = officeLayout.obstacles as ObstacleRect[];
const snapshot = () => Uint8Array.from(NAV);

beforeEach(() => { initGrid(obstacles); });

describe('a moving obstacle', () => {
  it('blocks exactly the cells the same rectangle blocks as fixed furniture', () => {
    for (const k of [3, 40, 77]) {
      const rect = obstacles[k];
      initGrid(obstacles);
      const fixed = snapshot();
      initGrid(obstacles.filter((_, i) => i !== k));
      setBlocker(1, rect);
      expect(snapshot()).toEqual(fixed);
    }
  });

  it('gives the floor back when it moves away, and when it is picked up', () => {
    initGrid([]); // (open floor: the office has a desk here)
    const before = snapshot();
    const rect: ObstacleRect = [440, 590, 460, 610];
    setBlocker(5, rect);
    expect(walkPx(450, 600)).toBe(false);
    setBlocker(5, [500, 590, 520, 610]);
    expect(walkPx(450, 600)).toBe(true);
    expect(walkPx(510, 600)).toBe(false);
    setBlocker(5, null);
    expect(snapshot()).toEqual(before);
  });

  it('two that overlap: the floor between them is free only when both have gone', () => {
    initGrid([]);
    setBlocker(1, [440, 590, 460, 610]);
    setBlocker(2, [450, 590, 470, 610]);
    setBlocker(1, null);
    expect(walkPx(458, 600)).toBe(false); // (still under the second)
    setBlocker(2, null);
    expect(walkPx(458, 600)).toBe(true);
  });

  it('never frees what the building or fixed furniture blocks', () => {
    const fixed = obstacles[10];
    const inside = [(fixed[0] + fixed[2]) / 2, (fixed[1] + fixed[3]) / 2] as const;
    expect(walkPx(...inside)).toBe(false);
    setBlocker(9, fixed);
    setBlocker(9, null);
    expect(walkPx(...inside)).toBe(false);
  });

  it('counts a change, so walkers can tell their route may be out of date; a move within the same cells is not one', () => {
    const v0 = navVersion();
    setBlocker(1, [440, 590, 460, 610]);
    const v1 = navVersion();
    expect(v1).toBeGreaterThan(v0);
    setBlocker(1, [440.1, 590, 460.1, 610]);
    expect(navVersion()).toBe(v1);
  });
});

describe('people walking', () => {
  beforeEach(() => { resetSim(); initState(); initGrid(obstacles); });

  it('plan again round something put across their way, and still get there', () => {
    const from = new Vec3((420 - OX) * S, 0, (650 - OY) * S), to = new Vec3((640 - OX) * S, 0, (650 - OY) * S);
    const path = findPath(from, to)!;
    expect(path).not.toBeNull();
    const p = { pos: new Vec3(from.x, 0, from.z), state: 'walking', path, pi: 0, speed: 1.2, task: null, animT: 0, walkPhase: 0, faceGoal: 0 } as unknown as Person;
    // a wall of table across the middle of the route, with a way round
    const mid = path[Math.floor(path.length / 2)], [mx, my] = [mid.x / S + OX, mid.z / S + OY];
    setBlocker(1, [mx - 4, my - 30, mx + 4, my + 30]);
    stepPerson(p, .05);
    const again = p.path!;
    for (let i = 1; i < again.length - 1; i++) expect(walkPx(again[i].x / S + OX, again[i].z / S + OY), `point ${i}`).toBe(true);
    expect(again[again.length - 1].x).toBeCloseTo(to.x, 6);
  });

  it('a route nothing was put across is left alone', () => {
    const from = new Vec3((420 - OX) * S, 0, (650 - OY) * S), to = new Vec3((640 - OX) * S, 0, (650 - OY) * S);
    const path = findPath(from, to)!;
    const p = { pos: new Vec3(from.x, 0, from.z), state: 'walking', path, pi: 0, speed: 1.2, task: null, animT: 0, walkPhase: 0, faceGoal: 0 } as unknown as Person;
    setBlocker(1, [130, 1000, 140, 1010]); // somewhere else entirely
    stepPerson(p, .05);
    expect(p.path).toBe(path);
  });
});
