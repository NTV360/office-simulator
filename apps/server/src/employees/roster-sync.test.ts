import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSlot, interactables, normalizeSpec, people, roster, simEvents, takeControl, type Person } from '@office/shared';
import { World } from '../world/world';
import type { EmployeeRecord } from './employee-store';
import { setRoster, syncRoster } from './roster-sync';

// The office is the staff list: the real world, the real layout (80 desks, the HR office), and a list of employees.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rec = (n: number, over: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  userId: U(n), firstName: `First${n}`, lastName: `Last${n}`, department: 'UI/UX', intern: false, shift: null, character: null, desk: null, photo: null, removed: false, ...over,
});
const options = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 7 };
const staff = () => people.filter(hasSlot);
const by = (n: number): Person => people.find(p => p.userId === U(n))!;
let events: string[];

function fresh(records: EmployeeRecord[]): void {
  simEvents.clear();
  roster.list = null;
  if (records.length) setRoster(records);
  new World(options).init(null);
  events = [];
  simEvents.on('personAdded', () => events.push('added'));
  simEvents.on('personRemoved', () => events.push('removed'));
  simEvents.on('personUpdated', () => events.push('updated'));
}
beforeEach(() => { events = []; });
afterEach(() => { roster.list = null; simEvents.clear(); });

describe('an office made from a staff list', () => {
  it('everyone on the list is there, with their name, title and department, and nobody else', () => {
    fresh([rec(1), rec(2, { department: 'Quality Assurance', intern: true }), rec(3, { department: null })]);
    expect(staff()).toHaveLength(3);
    expect(by(1)).toMatchObject({ name: 'First1 Last1', title: 'UI/UX Department', department: 'UI/UX', role: 'Designer' });
    expect(by(2)).toMatchObject({ title: 'Intern Quality Assurance', role: 'QA Engineer' });
    expect(by(3)).toMatchObject({ title: 'Staff', department: null });
  });
  it('an employee is at the desk they chose; HR staff are in the HR office; nobody else is', () => {
    fresh([rec(1, { desk: 'C3' }), rec(2, { department: 'Human Resources' }), rec(3, { department: 'Human Resources', desk: 'HR5' }), rec(4)]);
    expect(by(1).slot!.deskId).toBe('C3');
    expect(by(3).slot!.deskId).toBe('HR5');
    for (const n of [2, 3]) expect(by(n).slot!.department).toBe('Human Resources');
    for (const n of [1, 4]) expect(by(n).slot!.department ?? null).toBeNull();
  });
  it('a saved look is worn; Hazel keeps her furious face', () => {
    fresh([rec(1, { character: { type: 'blocky', hair: { style: 'bun', color: '#112233' } } }), rec(2, { firstName: 'Hazel', lastName: 'Sellote' })]);
    expect(by(1).spec).toMatchObject({ type: 'blocky', hair: { style: 'bun', color: '#112233' } });
    expect(by(2)).toMatchObject({ name: 'Hazel Sellote' });
    expect(by(2).spec.angry).toBe(true);
  });
  it('the same list gives the same office every time (an employee without a look gets one made from their id)', () => {
    fresh([rec(1), rec(2), rec(3)]);
    const first = staff().map(p => JSON.stringify(p.spec));
    fresh([rec(1), rec(2), rec(3)]);
    expect(staff().map(p => JSON.stringify(p.spec))).toEqual(first);
  });
  it('a shift is kept, and the person arrives around its start', () => {
    fresh([rec(1, { shift: { code: 'NIGHT', start: 1260, end: 360 } })]);
    expect(by(1).shiftStart).toBe(1260);
    expect(by(1).arriveAt).toBeGreaterThan(1200);
  });
});

describe('keeping the office in line with the list', () => {
  it('a new employee comes in; the ones already here are not disturbed', () => {
    fresh([rec(1), rec(2)]);
    const before = [by(1), by(2)];
    const r = syncRoster([rec(1), rec(2), rec(3)]);
    expect(r).toMatchObject({ added: 1, updated: 0, removed: 0, replaced: 0 });
    expect(by(3)).toBeDefined();
    expect([by(1), by(2)]).toEqual(before);
    expect(events).toEqual(['added']);
  });
  it('a changed name, department or shift is applied to the person who is already here, and viewers are told once', () => {
    fresh([rec(1)]);
    const p = by(1);
    const r = syncRoster([rec(1, { firstName: 'Renamed', department: 'Human Resources', shift: { code: 'MID', start: 900, end: 0 } })]);
    expect(r.updated).toBe(1);
    expect(by(1)).toBe(p); // the same person
    expect(p).toMatchObject({ name: 'Renamed Last1', department: 'Human Resources', title: 'HR Department', role: 'Support', shift: { code: 'MID', start: 900, end: 0 } });
    expect(events).toEqual(['updated']);
    expect(syncRoster([rec(1, { firstName: 'Renamed', department: 'Human Resources', shift: { code: 'MID', start: 900, end: 0 } })]).updated).toBe(0); // nothing changed: nothing said
  });
  it('a new look is worn at once', () => {
    fresh([rec(1)]);
    syncRoster([rec(1, { character: { type: 'chibi', body: 'female', hair: { style: 'afro', color: '#000000' } } })]);
    expect(by(1).spec).toMatchObject({ type: 'chibi', body: 'female', hair: { style: 'afro' } });
  });
  it('a look the stored record holds in an old shape is made valid on the way in', () => {
    fresh([rec(1)]);
    syncRoster([rec(1, { character: { skin: '#c98f66', shirt: '#ff0000', style: 'bun' } })]);
    expect(by(1).spec).toEqual(normalizeSpec({ skin: '#c98f66' }));
  });
  it('a chosen desk is moved to (swapping with an ordinary person), but never by taking it from an account\'s person', () => {
    fresh([rec(1), rec(2)]);
    const target = by(2).slot!, mine = by(1).slot!;
    syncRoster([rec(1, { desk: target.deskId! }), rec(2)]);
    expect(by(1).slot).toBe(target); expect(by(2).slot).toBe(mine); // swapped
    // now the desk of someone an account owns
    const other = by(2);
    other.owner = 5;
    const wanted = other.slot!;
    syncRoster([rec(1, { desk: wanted.deskId! }), rec(2)]);
    expect(by(1).slot).not.toBe(wanted);
  });
  it('an employee who has left the records goes; so does their desk occupancy', () => {
    fresh([rec(1), rec(2), rec(3)]);
    const desk = by(2).slot!;
    const r = syncRoster([rec(1), rec(3)]);
    expect(r.removed).toBe(1);
    expect(staff().map(p => p.userId).sort()).toEqual([U(1), U(3)]);
    expect(desk.owner == null).toBe(true);
    expect(events).toEqual(['removed']);
  });
  it('but never someone who belongs to an account, or whom a human is driving', () => {
    fresh([rec(1), rec(2), rec(3)]);
    by(1).owner = 9; // belongs to an account
    takeControl(by(2)); // a human is driving them
    const r = syncRoster([rec(3)]);
    expect(r.removed).toBe(0);
    expect(staff().map(p => p.userId).sort()).toEqual([U(1), U(2), U(3)]);
  });
  it('made-up staff make way for the real ones the first time there is a list (but not those who belong to an account)', () => {
    fresh([]); // no list: 40 made-up staff
    expect(staff()).toHaveLength(40);
    staff()[5].owner = 3;
    const keep = staff()[5];
    const r = syncRoster([rec(1), rec(2), rec(3)]);
    expect(r).toMatchObject({ replaced: 39, added: 3 });
    expect(staff()).toHaveLength(4);
    expect(staff()).toContain(keep);
    expect([by(1), by(2), by(3)].every(Boolean)).toBe(true);
  });
  it('an empty list changes nothing (the office is left as it is)', () => {
    fresh([rec(1), rec(2)]);
    const r = syncRoster([]);
    expect(r).toEqual({ added: 0, updated: 0, removed: 0, replaced: 0 });
    expect(staff()).toHaveLength(2);
    expect(roster.list).toBeNull();
  });
  it('more employees than desks: the ones who fit come in, and the rest wait (the other HR desks are for HR only)', () => {
    const many = Array.from({ length: 90 }, (_, i) => rec(i + 1, { department: i < 3 ? 'Human Resources' : 'UI/UX' }));
    fresh(many);
    expect(staff().length).toBe(74 + 3); // the 74 ordinary desks and the 3 HR desks the 3 HR staff fill
    expect(interactables.of('desk').filter(d => !d.owner).every(d => d.department === 'Human Resources')).toBe(true);
  });
});
