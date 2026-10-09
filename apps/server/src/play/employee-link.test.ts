import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { buildTestLayout, initDay, interactables, isAi, moveToDesk, people, removePerson, roster, setSeed, simEvents, type Employee, type Person } from '@office/shared';
import { MemoryAccountStore, type Account } from '../auth/account-store';
import { PlayError, PlayerManager, type Timers } from './player-manager';

// Accounts that play employees: the link, logging in, and what an employee keeps when an account comes and goes.

class FakeTimers implements Timers {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; at: number }>();
  now = 0;
  set(fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { fn, at: this.now + ms }); return id; }
  clear(h: unknown) { this.pending.delete(h as number); }
  advance(ms: number) { this.now += ms; for (const [id, t] of [...this.pending]) if (t.at <= this.now) { this.pending.delete(id); t.fn(); } }
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const emp = (n: number, over: Partial<Employee> = {}): Employee => ({ userId: U(n), firstName: `Emp${n}`, lastName: 'Cruz', department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over });

let store: MemoryAccountStore, timers: FakeTimers, kicks: Array<[number, string]>, manager: PlayerManager, updated: Person[];
const person = (n: number): Person => people.find(p => p.userId === U(n))!;
async function account(name: string): Promise<Account> {
  const a = await store.create({ username: name, passwordHash: 'h', role: 'player' });
  if (a === 'taken') throw new Error('taken');
  return (await store.byId(a.id))!;
}
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof PlayError ? e.code : 'other:' + String(e); } };

beforeEach(() => {
  simEvents.clear();
  setSeed(1);
  roster.list = [emp(1), emp(2), emp(3), emp(4, { department: 'Human Resources' })];
  buildTestLayout({ desks: 12, hr: 2 }); initDay();
  store = new MemoryAccountStore(); store.knownEmployees = new Set([1, 2, 3, 4, 5].map(U));
  timers = new FakeTimers(); kicks = []; updated = [];
  manager = new PlayerManager(store, { graceMs: 30_000, timers, kick: (id, why) => kicks.push([id, why]) });
  simEvents.on('personUpdated', p => updated.push(p));
});
afterEach(() => { roster.list = null; simEvents.clear(); setSeed(null); });

describe('linking an account to an employee', () => {
  it('makes the employee\'s person the account\'s: it belongs to them and keeps its own name', async () => {
    const ana = await account('ana');
    const p = await manager.linkEmployee(ana.id, U(2));
    expect(p).toBe(person(2));
    expect(p.owner).toBe(ana.id);
    expect(p.name).toBe('Emp2 Cruz'); // not "ana"
    expect((await store.byId(ana.id))!.employeeId).toBe(U(2));
    expect(updated).toContain(p);
  });
  it('is refused for an unknown account, an employee who is not in the office, one who is taken, and an account that is already linked or has a desk', async () => {
    const ana = await account('ana'), ben = await account('ben'), cat = await account('cat');
    expect(await code(manager.linkEmployee(999, U(1)))).toBe('no-account');
    expect(await code(manager.linkEmployee(ana.id, U(5)))).toBe('no-person'); // U(5) is not an employee here
    removePerson(person(3));
    expect(await code(manager.linkEmployee(ana.id, U(3)))).toBe('no-person'); // known to the records but not in the office
    expect(await code(manager.linkEmployee(ana.id, U(1)))).toBe('ok');
    expect(await code(manager.linkEmployee(ben.id, U(1)))).toBe('claimed'); // somebody plays them
    expect(await code(manager.linkEmployee(ana.id, U(2)))).toBe('has-employee'); // one at a time
    await store.setSlot(cat.id, interactables.of('desk')[11].id);
    expect(await code(manager.linkEmployee(cat.id, U(2)))).toBe('has-desk');
  });
  it('an account that is linked cannot be given a desk as well', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(1));
    const free = interactables.of('desk').find(d => d.owner && (d.owner as Person).owner === undefined && !(d.owner as Person).userId);
    expect(await code(manager.assignSlot(ana.id, (free ?? interactables.of('desk')[0]).id))).toBe('has-employee');
  });
  it('an account that was walking about as a guest is told to log in again, and the guest is gone', async () => {
    const ana = await account('ana');
    const guest = await manager.attach(ana);
    expect(guest.role).toBe('Guest');
    await manager.linkEmployee(ana.id, U(1));
    expect(people).not.toContain(guest);
    expect(kicks).toEqual([[ana.id, 'you were linked to an employee, log in again']]);
    expect(manager.isOnline(ana.id)).toBe(false);
  });
});

describe('playing a linked employee', () => {
  it('a login takes over that employee\'s person, where they are, under their own name', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(2));
    const p = await manager.attach((await store.byId(ana.id))!);
    expect(p).toBe(person(2));
    expect([p.controller, p.state, p.name, p.owner]).toEqual(['account', 'controlled', 'Emp2 Cruz', ana.id]);
    expect(manager.speaker(ana.id)?.name).toBe('Emp2 Cruz'); // chat says the employee's name
  });
  it('still plays them after they change desk', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(2));
    const p = person(2);
    const free = interactables.of('desk').find(d => !d.owner && !d.department)!;
    expect(moveToDesk(p, free)).toBe(true);
    expect(await manager.attach((await store.byId(ana.id))!)).toBe(p);
  });
  it('when the connection drops they go back to autopilot after the grace period and stay the account\'s', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(1));
    const p = await manager.attach((await store.byId(ana.id))!);
    manager.detach(ana.id);
    timers.advance(31_000);
    expect(isAi(p)).toBe(true);
    expect(p.owner).toBe(ana.id);
    expect(p.name).toBe('Emp1 Cruz');
  });
  it('a linked employee who is no longer in the office means a guest, not a crash', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(3));
    people.splice(people.indexOf(person(3)), 1); // gone from the world (and not told: a worst case)
    const p = await manager.attach((await store.byId(ana.id))!);
    expect(p.role).toBe('Guest');
  });
});

describe('unlinking', () => {
  it('leaves the employee as an ordinary person with their own name, and ends the account\'s play with a kick', async () => {
    const ana = await account('ana');
    await manager.linkEmployee(ana.id, U(2));
    await manager.attach((await store.byId(ana.id))!);
    const p = await manager.unlinkEmployee(ana.id);
    expect(p).toBe(person(2));
    expect(p!.owner).toBeUndefined();
    expect(p!.name).toBe('Emp2 Cruz'); // (not renamed to an NPC name)
    expect(isAi(p!)).toBe(true);
    expect((await store.byId(ana.id))!.employeeId).toBeNull();
    expect(kicks).toEqual([[ana.id, 'you were unlinked from your employee by an admin']]);
  });
  it('is refused when there is nothing to unlink', async () => {
    const ana = await account('ana');
    expect(await code(manager.unlinkEmployee(ana.id))).toBe('has-no-employee');
    expect(await code(manager.unlinkEmployee(999))).toBe('no-account');
  });
  it('lets the employee be linked to another account afterwards', async () => {
    const ana = await account('ana'), ben = await account('ben');
    await manager.linkEmployee(ana.id, U(1));
    await manager.unlinkEmployee(ana.id);
    expect(await code(manager.linkEmployee(ben.id, U(1)))).toBe('ok');
  });
});

describe('making the world agree with the accounts at start-up', () => {
  it('a linked account\'s employee belongs to them; a person who says they belong to an account that no longer has them is let go, keeping their name', async () => {
    const ana = await account('ana'), ben = await account('ben');
    await store.setEmployee(ana.id, U(1)); // the database says so; the world does not know yet
    person(2).owner = ben.id; // the world says so; the database does not
    const r = await manager.reconcile();
    expect(r).toEqual({ claimed: 1, released: 1 });
    expect(person(1).owner).toBe(ana.id);
    expect(person(2).owner).toBeUndefined();
    expect(person(2).name).toBe('Emp2 Cruz');
  });
  it('a linked employee who is not in the office is noted and skipped', async () => {
    const ana = await account('ana');
    await store.setEmployee(ana.id, U(5)); // known to the records, not in the world
    expect(await manager.reconcile()).toEqual({ claimed: 0, released: 0 });
  });
});
