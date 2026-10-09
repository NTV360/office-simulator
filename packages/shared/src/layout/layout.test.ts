import { beforeEach, describe, expect, it } from 'vitest';
import { findPath } from '../nav/astar';
import { NAV } from '../nav/grid';
import { initDay } from '../sim/day';
import { interactables } from '../sim/interactables';
import { hasSlot } from '../sim/person';
import { ENTRY } from '../sim/spots';
import { meetings, people, resetSim, sim, initState } from '../sim/state';
import { stepSim } from '../sim/step';
import { setSeed } from '../util';
import { objects } from '../world/objects';
import { loadLayout, spotsToLayout } from './layout';
import { officeLayout } from './office';

beforeEach(() => { resetSim(); loadLayout(officeLayout); });

describe('the office layout data', () => {
  it('has the recorded shape', () => {
    const kinds: Record<string, number> = {};
    for (const s of officeLayout.spots) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    expect(kinds).toEqual({ desk: 80, conf: 14, lounge: 12, bar: 4, booth: 4, dining: 18, golf: 1, darts: 2, piano: 1, guitar: 1, counter: 2, sink: 2, storage: 2, locker: 4, exit: 1 });
    expect(officeLayout.obstacles).toHaveLength(113);
  });
  it('rebuilds the same spots with the same ids, in the same order', () => {
    expect(interactables.all().map(s => s.id)).toEqual(officeLayout.spots.map(s => s.id));
    expect(interactables.of('desk')).toHaveLength(80); // 72 at the tables A to H, 5 HR, 2 CTO, 1 cleaner
    expect(interactables.of('music')).toHaveLength(2); // piano and guitar share a group
    expect(interactables.conf(1).length + interactables.conf(2).length + interactables.conf(3).length).toBe(14);
  });
  it('saving what was loaded gives the same data (round trip)', () => {
    const again = spotsToLayout(interactables.all(), officeLayout.obstacles, objects.all());
    expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(officeLayout)));
  });
  it('builds the same walkable grid the browser has (11,527 cells)', () => {
    expect(NAV.reduce((a, v) => a + v, 0)).toBe(11527);
  });
  it('has a route from the door to every desk, and an exit', () => {
    for (const d of interactables.of('desk')) expect(findPath(ENTRY, d.approach), d.id).not.toBeNull();
    expect(interactables.of('exit')).toHaveLength(1);
  });
  it('has a route from the door to every spot of every kind (nothing is walled in by the furniture)', () => {
    for (const s of interactables.all()) expect(findPath(ENTRY, s.approach), s.id).not.toBeNull();
  });
  it('loading twice does not stack spots', () => {
    loadLayout(officeLayout);
    expect(interactables.all()).toHaveLength(officeLayout.spots.length);
  });
  it('rejects data in the wrong order', () => {
    const bad = { ...officeLayout, spots: [officeLayout.spots[1], officeLayout.spots[0], ...officeLayout.spots.slice(2)] };
    expect(() => loadLayout(bad)).toThrow();
  });
  it('runs a seeded day on the real office', () => {
    setSeed(1); initState(); initDay();
    expect(people.filter(hasSlot)).toHaveLength(40);
    for (let i = 0; i < 12000; i++) stepSim(.05);
    expect(sim.t).toBeGreaterThan(12 * 60);
    expect(people.filter(p => p.state !== 'away').length).toBeGreaterThan(25);
    expect(meetings.length).toBeGreaterThanOrEqual(0);
    setSeed(null);
  });
});
