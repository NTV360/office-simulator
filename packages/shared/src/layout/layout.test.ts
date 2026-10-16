import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPath } from '../nav/astar';
import { NAV } from '../nav/grid';
import { initDay } from '../sim/day';
import { interactables } from '../sim/interactables';
import { hasSlot } from '../sim/person';
import { roster } from '../sim/roster';
import { ENTRY } from '../sim/spots';
import { meetings, people, resetSim, sim, initState } from '../sim/state';
import { stepSim } from '../sim/step';
import { setSeed } from '../util';
import { objects } from '../world/objects';
import { loadLayout, spotsToLayout } from './layout';
import { officeLayout } from './office';

const testRoster = Array.from({ length: 40 }, (_, i) => ({
  userId: `layout-${i + 1}`, firstName: i === 0 ? 'Hazel' : `Test${i + 1}`, lastName: i === 0 ? 'Sellote' : 'Employee', department: 'UI/UX' as string | null,
  intern: false, shift: null, character: null, desk: null,
}));

beforeEach(() => { resetSim(); roster.list = testRoster; roster.status = 'ready'; loadLayout(officeLayout); });
afterEach(() => { roster.list = null; roster.status = 'unavailable'; });

describe('the office layout data', () => {
  it('has the recorded shape', () => {
    const kinds: Record<string, number> = {};
    for (const s of officeLayout.spots) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    expect(kinds).toEqual({ desk: 80, whiteboard: 6, conf: 16, teach: 1, lounge: 12, bar: 4, booth: 4, dining: 18, golf: 1, darts: 2, piano: 1, guitar: 1, counter: 2, sink: 2, snack: 2, bucket: 1, storage: 2, locker: 4, exit: 1 });
    expect(officeLayout.obstacles).toHaveLength(76); // (113 before 38 pieces of furniture became items: they block where they stand instead; the fridge is the 76th)
  });
  it('rebuilds the same spots with the same ids, in the same order', () => {
    expect(interactables.all().map(s => s.id)).toEqual(officeLayout.spots.map(s => s.id));
    expect(interactables.of('desk')).toHaveLength(80); // islands A to H and the HR office
    expect(interactables.of('music')).toHaveLength(2); // piano and guitar share a group
    expect(interactables.conf(1).length + interactables.conf(2).length + interactables.conf(3).length).toBe(16);
  });
  it('saving what was loaded gives the same data (round trip)', () => {
    const again = spotsToLayout(interactables.all(), officeLayout.obstacles, objects.all(), officeLayout.tops);
    expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(officeLayout)));
  });
  it('builds the same walkable grid the browser has (12,207 cells)', () => {
    expect(NAV.reduce((a, v) => a + v, 0)).toBe(12207);
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
