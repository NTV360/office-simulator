import { beforeEach, describe, expect, it } from 'vitest';
import { interactables } from '../sim/interactables';
import { resetSim } from '../sim/state';
import { DESK_ISLANDS, deskSeat, deskSeats } from './desks';
import { loadLayout } from './layout';
import { officeLayout } from './office';

// The desks come from the desk data (the same file `main` keeps): islands A to H and the HR office, seat ids like 'A3'.

beforeEach(() => { resetSim(); loadLayout(officeLayout); });
const desks = () => interactables.of('desk');

describe('the desk data', () => {
  it('has 80 seats: 8 at A, B, C, E and F, 10 at D, 12 at G and H, 6 in the HR office', () => {
    const count = (id: string) => deskSeats().filter(s => s.island.id === id).length;
    expect(DESK_ISLANDS.map(i => [i.id, count(i.id)])).toEqual([['A', 8], ['B', 8], ['C', 8], ['D', 10], ['E', 8], ['F', 8], ['G', 12], ['H', 12], ['HR', 6]]);
    expect(deskSeats()).toHaveLength(80);
  });
  it('seat ids are the island and a number, with the top row numbered first', () => {
    expect(deskSeats().slice(0, 9).map(s => s.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B1']);
    expect(deskSeat('HR2')?.label).toBe('HR Office · desk 2');
    expect(deskSeat('A3')?.label).toBe('Desk A3');
    expect(deskSeat('Z9')).toBeNull();
    expect(deskSeat(null)).toBeNull();
  });
  it('only the HR office is a room reserved for a department', () => {
    expect(DESK_ISLANDS.filter(i => i.department).map(i => [i.id, i.department])).toEqual([['HR', 'Human Resources']]);
  });
});

describe('the desks in the office', () => {
  it('there is one desk spot per seat, in the same order, each knowing its seat id, label and department', () => {
    const seats = deskSeats();
    expect(desks()).toHaveLength(seats.length);
    desks().forEach((d, i) => {
      expect(d.deskId, d.id).toBe(seats[i].id);
      expect(d.label, d.id).toBe(seats[i].label);
      expect(d.department ?? null, d.id).toBe(seats[i].island.department ?? null);
    });
  });
  it('each chair is where the desk data puts it (to within a hand)', () => {
    const toPx = (v: { x: number; z: number }) => [v.x / 0.041 + 397.85, v.z / 0.041 + 577.05];
    desks().forEach((d, i) => {
      const [x, y] = toPx(d.pos), s = deskSeats()[i];
      expect(Math.abs(x - s.px), d.id).toBeLessThan(.5);
      expect(Math.abs(y - s.py), d.id).toBeLessThan(.5);
    });
  });
  it('the HR desks are the six in the old Conference 2, and no other desk has a department', () => {
    const hr = desks().filter(d => d.department === 'Human Resources');
    expect(hr).toHaveLength(6);
    expect(desks().filter(d => d.department)).toHaveLength(6);
    const toPx = (v: { x: number; z: number }) => [v.x / 0.041 + 397.85, v.z / 0.041 + 577.05];
    for (const d of hr) { const [x, y] = toPx(d.pos); expect(x > 263 && x < 400 && y > 71 && y < 193, d.id).toBe(true); }
  });
  it('the front wall is where the plan says, so the door, the walkway and the arrival point agree', () => {
    const exit = interactables.of('exit')[0], toPx = (v: { x: number; z: number }) => [v.x / 0.041 + 397.85, v.z / 0.041 + 577.05];
    expect(toPx(exit.pos)[1]).toBeCloseTo(425 + 31, 3);
  });
});
