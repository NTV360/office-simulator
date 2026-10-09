import { beforeEach, describe, expect, it } from 'vitest';
import { findPath } from '../nav/astar';
import { initDay } from '../sim/day';
import { interactables } from '../sim/interactables';
import { hasSlot } from '../sim/person';
import { ENTRY } from '../sim/spots';
import { initState, meetings, people, resetSim, sim } from '../sim/state';
import { setStaffCount } from '../sim/factory';
import { stepSim } from '../sim/step';
import { setSeed } from '../util';
import { loadLayout } from './layout';
import { officeLayout } from './office';

// The HR office (Conference 2), the CTO desks (Conference 1), the cleaner's station and the eight tables A to H.

beforeEach(() => { resetSim(); loadLayout(officeLayout); });
const desks = () => interactables.of('desk');
const staff = () => people.filter(hasSlot);

describe('the stations', () => {
  it('there are 80 desks: 72 at tables A to H, 5 HR, 2 CTO and 1 cleaner', () => {
    expect(desks()).toHaveLength(80);
    const place = (name: string) => desks().filter(d => d.place === name).length;
    expect(['Table A', 'Table B', 'Table C', 'Table D', 'Table E', 'Table F'].map(place)).toEqual([8, 8, 8, 8, 8, 8]);
    expect([place('Table G'), place('Table H')]).toEqual([12, 12]);
    expect([desks().filter(d => d.role === 'HR').length, desks().filter(d => d.role === 'CTO').length, desks().filter(d => d.role === 'Cleaner').length]).toEqual([5, 2, 1]);
    expect(desks().filter(d => !d.role)).toHaveLength(72);
  });

  it('the older 70 desks keep their ids (so desks already given to accounts stay theirs); the 10 new ones come after', () => {
    expect(desks().slice(0, 70).every(d => !d.role && /^Table /.test(d.place))).toBe(true);
    expect(desks().slice(64, 72).every(d => d.place === 'Table F')).toBe(true); // F: the old six and the two new
    expect(desks().slice(72).map(d => d.role)).toEqual(['HR', 'HR', 'HR', 'HR', 'HR', 'CTO', 'CTO', 'Cleaner']);
  });

  it('the HR desks are in Conference 2, the CTO desks in Conference 1, the cleaner in the storage room', () => {
    const px = (d: { pos: { x: number; z: number } }) => [d.pos.x / 0.041 + 397.85, d.pos.z / 0.041 + 577.05];
    for (const d of desks().filter(x => x.role === 'HR')) { const [x, y] = px(d); expect(x > 263 && x < 400 && y > 71 && y < 193, d.id).toBe(true); }
    for (const d of desks().filter(x => x.role === 'CTO')) { const [x, y] = px(d); expect(x > 114 && x < 262 && y > 71 && y < 193, d.id).toBe(true); }
    const [cx, cy] = px(desks().find(x => x.role === 'Cleaner')!);
    expect(cx > 272 && cx < 352 && cy > 1039 && cy < 1083).toBe(true);
  });

  it('every desk can be walked to from the door, and sat at (a seat, not a shared one)', () => {
    for (const d of desks()) {
      expect(findPath(ENTRY, d.approach), d.id).not.toBeNull();
      expect(d.sit && !d.shared, d.id).toBe(true);
    }
  });

  it('Conference 2 has no meeting seats now and Conference 1 has six; the starting day holds its sync in Conference 3', () => {
    expect([1, 2, 3].map(r => interactables.conf(r).length)).toEqual([6, 0, 8]);
    setSeed(1); initState(); initDay(40);
    expect(meetings.map(m => m.room).sort()).toEqual([1, 3]);
  });

  it('a whole day: no meeting is ever held in Conference 2', () => {
    setSeed(2); initState(); initDay(80);
    const rooms = new Set<number>();
    while (sim.day === 1) { stepSim(0.05); for (const m of meetings) rooms.add(m.room); }
    expect(rooms.has(2)).toBe(false);
    expect(rooms.size).toBeGreaterThan(0);
  });
});

describe('who sits where', () => {
  it('the people at role desks have that role, and nobody else does', () => {
    setSeed(1); initState(); initDay(80);
    for (const p of staff()) {
      if (p.slot!.role) expect(p.role, p.slot!.id).toBe(p.slot!.role);
      else expect(['HR', 'CTO', 'Cleaner']).not.toContain(p.role);
    }
    expect(staff()).toHaveLength(80);
  });

  it('even a small office has its HR and CTOs: they are seated first, after Hazel, who always has an ordinary desk', () => {
    setSeed(3); initState(); initDay(8);
    const roles = staff().map(p => p.role).sort();
    expect(roles).toEqual(['CTO', 'CTO', 'HR', 'HR', 'HR', 'HR', 'HR', 'UX/UI Designer']);
    const hazel = staff().find(p => p.name === 'Hazel Sellote')!;
    expect(hazel.slot!.role).toBeUndefined();
  });

  it('the cleaner comes ninth, and growing or shrinking the office keeps them', () => {
    setSeed(4); initState(); initDay(9);
    expect(staff().map(p => p.role)).toContain('Cleaner');
    setStaffCount(80);
    expect(staff()).toHaveLength(80);
    setStaffCount(9);
    expect(staff().map(p => p.role).sort().filter(r => ['HR', 'CTO', 'Cleaner'].includes(r))).toEqual(['CTO', 'CTO', 'Cleaner', 'HR', 'HR', 'HR', 'HR', 'HR']);
  });
});
