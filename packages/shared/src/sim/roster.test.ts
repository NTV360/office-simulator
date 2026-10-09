import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drawCount, setSeed } from '../util';
import { simEvents } from './events';
import { initDay } from './day';
import { makeStaff, moveToDesk, removeStaff, seatById, setStaffCount } from './factory';
import { interactables } from './interactables';
import { hasSlot } from './person';
import { fullName, jobTitle, roster, simRole, unplacedEmployees, type Employee } from './roster';
import { DAY_END } from './schedule';
import { bucketRun } from './tasks';
import { handBack, takeControl } from './takeover';
import { counters, deskPool, meetings, people } from './state';
import { buildTestLayout } from './testing';

// Real employees in the office: their names, jobs, shifts and desks, and the rule that the HR office is for HR.

const emp = (id: string, over: Partial<Employee> = {}): Employee => ({ userId: id, firstName: id, lastName: 'Cruz', department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over });
const staff = () => people.filter(hasSlot);
const by = (id: string) => people.find(p => p.userId === id)!;

beforeEach(() => { setSeed(1); buildTestLayout({ desks: 20, hr: 6 }); });
afterEach(() => { roster.list = null; setSeed(null); });

describe('what the card says', () => {
  it('a department staff member is "<Department> Department", an intern is "Intern <Department>", and a few names are shortened', () => {
    expect(jobTitle({ department: 'UI/UX', intern: false })).toBe('UI/UX Department');
    expect(jobTitle({ department: 'UI/UX', intern: true })).toBe('Intern UI/UX');
    expect(jobTitle({ department: 'Human Resources', intern: false })).toBe('HR Department');
    expect(jobTitle({ department: 'Internet of Things (IoT)', intern: false })).toBe('IoT Department');
    expect(jobTitle({ department: null, intern: false })).toBe('Staff');
    expect(jobTitle({ department: null, intern: true })).toBe('Intern');
  });
  it('the department decides which role the activities and screens use', () => {
    expect(simRole('Graphics Design')).toBe('Designer');
    expect(simRole('UI/UX')).toBe('Designer');
    expect(simRole('Quality Assurance')).toBe('QA Engineer');
    expect(simRole('Human Resources')).toBe('Support');
    expect(simRole('DevOps')).toBe('DevOps');
    expect(simRole('Something else')).toBe('Developer');
    expect(simRole(null)).toBe('Developer');
  });
  it('names are first and last, trimmed', () => {
    expect(fullName({ firstName: 'Ana', lastName: 'Cruz' })).toBe('Ana Cruz');
    expect(fullName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
  });
});

describe('the staff list becomes the people in the office', () => {
  it('everyone on the list is there, with their name, title, department, role and id', () => {
    roster.list = [emp('a', { department: 'UI/UX' }), emp('b', { department: 'Quality Assurance', intern: true }), emp('c', { department: null })];
    initDay();
    expect(staff()).toHaveLength(3);
    expect(by('a')).toMatchObject({ name: 'a Cruz', title: 'UI/UX Department', department: 'UI/UX', role: 'Designer', userId: 'a' });
    expect(by('b')).toMatchObject({ title: 'Intern Quality Assurance', role: 'QA Engineer' });
    expect(by('c')).toMatchObject({ title: 'Staff', department: null });
  });
  it('the desk someone chose is theirs, and a chosen desk stays free for the one who chose it even if they are created later', () => {
    roster.list = [emp('early'), emp('late', { desk: 'T3' }), emp('also', { desk: 'T1' })];
    deskPool.length = 0; deskPool.push(...interactables.of('desk')); // the desks in order (T1 first), so the first person would take T1 if it were not kept
    initDay();
    expect(by('late').slot!.deskId).toBe('T3');
    expect(by('also').slot!.deskId).toBe('T1');
    expect(['T1', 'T3']).not.toContain(by('early').slot!.deskId);
  });
  it('the HR office is only for the HR department: HR staff sit there, nobody else does, even when the other desks run out', () => {
    roster.list = [
      ...Array.from({ length: 6 }, (_, i) => emp('hr' + i, { department: 'Human Resources' })),
      ...Array.from({ length: 24 }, (_, i) => emp('x' + i)), // 20 ordinary desks: 4 of these have nowhere to sit
    ];
    initDay();
    const hrDesks = interactables.of('desk').filter(d => d.department === 'Human Resources');
    expect(hrDesks).toHaveLength(6);
    for (const p of staff()) {
      const inHr = p.slot!.department === 'Human Resources';
      expect(inHr, p.name).toBe(p.department === 'Human Resources');
    }
    expect(staff().filter(p => p.department === 'Human Resources')).toHaveLength(6);
    expect(staff().filter(p => p.department !== 'Human Resources')).toHaveLength(20);
  });
  it('made-up staff (no staff list) never sit in the HR office', () => {
    roster.list = null;
    initDay(40);
    expect(staff()).toHaveLength(20); // only the 20 ordinary desks
    expect(staff().every(p => !p.slot!.department)).toBe(true);
  });
  it('an employee whose chosen desk does not exist gets a free one instead', () => {
    roster.list = [emp('a', { desk: 'Z99' })];
    initDay();
    expect(by('a').slot).toBeDefined();
  });
  it('someone who is not in HR cannot choose a desk in the HR office', () => {
    roster.list = [emp('x', { desk: 'T21' }), emp('hr', { department: 'Human Resources', desk: 'T21' })]; // T21 is the first HR desk
    initDay();
    expect(by('x').slot!.department ?? null).toBeNull();
    expect(by('hr').slot!.deskId).toBe('T21');
  });
  it('a failed attempt to add staff (only the HR desks are free) uses up no name and no random numbers', () => {
    roster.list = null;
    initDay(20); // every ordinary desk
    expect(deskPool.some(s => !s.owner)).toBe(true); // the six HR desks
    const names = counters.nameIdx, draws = drawCount();
    expect(makeStaff()).toBeNull();
    expect(counters.nameIdx).toBe(names);
    expect(drawCount()).toBe(draws);
  });
  it('seat ids find the desk', () => {
    expect(seatById('T4')).toBe(interactables.of('desk')[3]);
    expect(seatById('nope')).toBeNull();
  });
});

describe('shifts', () => {
  it('everyone arrives around the start of their own shift and leaves around its end', () => {
    roster.list = [
      emp('day'),
      emp('night', { shift: { code: 'NIGHT', start: 21 * 60, end: 6 * 60 } }),
      emp('mid', { shift: { code: 'MID', start: 15 * 60, end: 0 } }),
    ];
    initDay();
    expect(by('day').shiftStart).toBe(9 * 60);
    expect(by('night').shiftStart).toBe(21 * 60);
    for (const [id, start, end] of [['day', 9 * 60, 18 * 60], ['night', 21 * 60, 30 * 60], ['mid', 15 * 60, 24 * 60]] as const) {
      const p = by(id);
      expect(p.arriveAt).toBeGreaterThanOrEqual(start - 20); expect(p.arriveAt).toBeLessThanOrEqual(start + 12);
      expect(p.leaveAt).toBeGreaterThanOrEqual(Math.min(DAY_END - 6, end)); expect(p.leaveAt).toBeLessThanOrEqual(Math.min(DAY_END - 6, end + 20));
      expect(p.lunchAt).toBeGreaterThanOrEqual(start + 3 * 60); expect(p.lunchAt).toBeLessThanOrEqual(start + 3 * 60 + 25);
    }
  });
  it('Hazel is the last one out of her shift', () => {
    roster.list = [emp('day'), emp('H', { firstName: 'Hazel', lastName: 'Sellote' }), emp('night', { shift: { code: 'NIGHT', start: 21 * 60, end: 6 * 60 } })];
    initDay();
    const hazel = people.find(p => p.name === 'Hazel Sellote')!;
    expect(hazel.leaveAt).toBe(18 * 60 + 62);
    expect(hazel.spec.angry).toBe(true);
    expect(by('day').leaveAt).toBeLessThan(hazel.leaveAt);
  });
});

describe('the HR office when people move', () => {
  it('only HR staff can move into an HR desk, and a swap never puts an HR person in an ordinary desk by force or a non-HR person in the HR office', () => {
    roster.list = [emp('a'), emp('hr', { department: 'Human Resources' })];
    initDay();
    const a = by('a'), hr = by('hr'), hrDesk = hr.slot!, aDesk = a.slot!;
    expect(moveToDesk(a, hrDesk)).toBe(false); // a is not HR
    expect(a.slot).toBe(aDesk); expect(hr.slot).toBe(hrDesk);
    expect(moveToDesk(hr, aDesk)).toBe(false); // the swap would put a in the HR office
    expect(hr.slot).toBe(hrDesk);
    const free = deskPool.find(s => !s.owner && !s.department)!;
    expect(moveToDesk(hr, free)).toBe(true); // an HR person may sit at an ordinary desk
  });
  it('every viewer is told about a move (both people in a swap)', () => {
    roster.list = [emp('a'), emp('b')];
    initDay();
    const told: string[] = [];
    simEvents.on('personUpdated', p => told.push(p.userId!));
    expect(moveToDesk(by('a'), by('b').slot ?? null)).toBe(true);
    expect(told.sort()).toEqual(['a', 'b']);
    simEvents.clear();
  });
  it('someone eating a snack at their desk walks to the new one', () => {
    roster.list = [emp('a')];
    initDay();
    const a = by('a');
    a.state = 'doing'; a.shown = true; a.task = { kind: 'snackDesk', cat: 'pantry', anim: 'eat', spot: a.slot!, dur: 5 };
    const free = deskPool.find(s => !s.owner && !s.department)!;
    moveToDesk(a, free);
    expect(a.task?.spot).toBe(free);
  });
});

describe('the one bucket', () => {
  it('nobody can start the toilet run while the bucket is out with someone else, and anyone can once it is back', () => {
    roster.list = [emp('a'), emp('b')];
    initDay();
    const a = by('a'), b = by('b');
    a.props.bucket = true; // out of the building with it
    a.state = 'away'; a.shown = false; a.toiletUntil = 700;
    expect(bucketRun(b)).toBe(false);
    a.props.bucket = false; a.toiletUntil = null;
    expect(bucketRun(b)).toBe(true);
    expect(b.task?.kind).toBe('bucket');
    expect(b.task?.run).toBe(true);
  });
  it('a bucket left with someone a human has taken over does not stop everybody else, and is put back', () => {
    roster.list = [emp('a'), emp('b')];
    initDay();
    const a = by('a'), b = by('b');
    a.props.bucket = true; a.state = 'away'; a.shown = false; a.toiletUntil = 700;
    takeControl(a);
    expect(a.props.bucket).toBe(false); expect(a.toiletUntil).toBeNull(); expect(a.shown).toBe(true);
    expect(bucketRun(b)).toBe(true);
    b.props.bucket = true; b.toiletUntil = 800; b.state = 'away';
    takeControl(b); handBack(b);
    expect(b.props.bucket).toBe(false); expect(b.toiletUntil).toBeNull();
  });
});

describe('moving people between desks', () => {
  it('moving to a free desk frees the old one', () => {
    roster.list = [emp('a'), emp('b')];
    initDay();
    const a = by('a'), old = a.slot!, free = deskPool.find(s => !s.owner && !s.department)!;
    moveToDesk(a, free);
    expect(a.slot).toBe(free); expect(free.owner).toBe(a); expect(old.owner).toBeNull();
  });
  it('moving to a desk someone has swaps the two', () => {
    roster.list = [emp('a'), emp('b')];
    initDay();
    const a = by('a'), b = by('b'), da = a.slot!, db = b.slot!;
    moveToDesk(a, db);
    expect(a.slot).toBe(db); expect(b.slot).toBe(da); expect(db.owner).toBe(a); expect(da.owner).toBe(b);
  });
  it('moving to the desk you already have, or to nothing, changes nothing', () => {
    roster.list = [emp('a')];
    initDay();
    const a = by('a'), d = a.slot!;
    moveToDesk(a, d); moveToDesk(a, null);
    expect(a.slot).toBe(d); expect(d.owner).toBe(a);
  });
});

describe('growing and shrinking the office', () => {
  it('removing staff hands the employees back to the list, and growing again brings the same ones in', () => {
    roster.list = Array.from({ length: 10 }, (_, i) => emp('e' + i));
    initDay();
    expect(staff()).toHaveLength(10);
    setStaffCount(6);
    expect(staff()).toHaveLength(6);
    expect(unplacedEmployees(people).map(e => e.userId).sort()).toEqual(['e6', 'e7', 'e8', 'e9']);
    setStaffCount(10);
    expect(staff().map(p => p.userId).sort()).toEqual(roster.list.map(e => e.userId).sort());
  });
  it('removing someone takes them out of the meeting they were in', () => {
    roster.list = Array.from({ length: 30 }, (_, i) => emp('e' + i));
    initDay();
    // (the start of the day has a training session and a sync)
    expect(meetings.length).toBeGreaterThan(0);
    const inMeetings = new Set(meetings.flatMap(m => m.members));
    expect(inMeetings.size).toBeGreaterThan(1);
    while (removeStaff()) { /* everyone goes */ }
    expect(staff()).toHaveLength(0);
    for (const m of meetings) { expect(m.members).toEqual([]); expect(m.speaker).toBeNull(); }
    expect(makeStaff()).not.toBeNull(); // and the desks are free again
  });
});
