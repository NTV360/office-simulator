import { beforeEach, describe, expect, it } from 'vitest';
import { HAZEL_NAME, drawCount, initDay, interactables, people, setSeed, sim, simEvents, stepSim, buildTestLayout, type Person } from '@office/shared';
import { MemoryAccountStore, type Account } from '../auth/account-store';
import { PlayError, PlayerManager, type Timers } from './player-manager';

// Who plays which person: logins, the grace period, and an admin giving and taking desks, on the shared test office.

/** Timers the test controls. */
class FakeTimers implements Timers {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; at: number }>();
  now = 0;
  set(fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { fn, at: this.now + ms }); return id; }
  clear(h: unknown) { this.pending.delete(h as number); }
  advance(ms: number) {
    this.now += ms;
    for (const [id, t] of [...this.pending]) if (t.at <= this.now) { this.pending.delete(id); t.fn(); }
  }
}

let store: MemoryAccountStore;
let timers: FakeTimers;
let kicks: Array<[number, string]>;
let manager: PlayerManager;
let updated: Person[];
const deskPerson = (n: number): Person => interactables.of('desk')[n].owner as Person;

async function account(name: string, slot: string | null = null): Promise<Account> {
  const a = await store.create({ username: name, passwordHash: 'h', role: 'player' });
  if (a === 'taken') throw new Error('taken');
  if (slot) await store.setSlot(a.id, slot);
  return (await store.byId(a.id))!;
}
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof PlayError ? e.code : 'other:' + String(e); } };

beforeEach(() => {
  simEvents.clear();
  setSeed(1); buildTestLayout({ desks: 40 }); initDay();
  store = new MemoryAccountStore(); timers = new FakeTimers(); kicks = []; updated = [];
  manager = new PlayerManager(store, { graceMs: 30_000, timers, kick: (id, why) => kicks.push([id, why]) });
  simEvents.on('personUpdated', p => updated.push(p));
});

describe('a login', () => {
  it('without a desk makes a guest at the entrance, who is gone 30 seconds after the connection drops', async () => {
    const ana = await account('ana');
    const g = await manager.attach(ana);
    expect([g.role, g.name, g.owner, g.controller, g.slot]).toEqual(['Guest', 'ana', ana.id, 'account', undefined]);
    expect(manager.isOnline(ana.id)).toBe(true);
    manager.detach(ana.id);
    timers.advance(29_999);
    expect(people).toContain(g);
    timers.advance(2);
    expect(people).not.toContain(g);
    expect(manager.isOnline(ana.id)).toBe(false);
  });

  it('reconnecting inside the grace period gets the same guest back, not a new one', async () => {
    const ana = await account('ana');
    const g = await manager.attach(ana);
    g.pos.x = 7;
    manager.detach(ana.id);
    timers.advance(10_000);
    const again = await manager.attach(ana);
    expect(again).toBe(g);
    expect(again.pos.x).toBe(7);
    timers.advance(60_000);
    expect(people).toContain(g); // the pending hand-back was cancelled
  });

  it('with a desk takes over that desk person where they stand', async () => {
    const bob = await account('bob', 'desk:5');
    const person = deskPerson(5);
    person.owner = bob.id;
    const at = [person.pos.x, person.pos.z];
    const got = await manager.attach(bob);
    expect(got).toBe(person);
    expect([got.controller, got.state, got.pos.x, got.pos.z]).toEqual(['account', 'controlled', ...at]);
  });

  it('keeps playing the same person for a whole day, never sent home', async () => {
    const bob = await account('bob', 'desk:5');
    deskPerson(5).owner = bob.id;
    const p = await manager.attach(bob);
    p.pos.x = 3;
    while (sim.day === 1) stepSim(.05);
    expect([p.state, p.shown, p.pos.x]).toEqual(['controlled', true, 3]);
  });

  it('when the connection drops for good, the person goes back to autopilot where they stand, still the account\'s', async () => {
    const bob = await account('bob', 'desk:6');
    deskPerson(6).owner = bob.id;
    const p = await manager.attach(bob);
    p.pos.x = 4; p.pos.z = 5;
    manager.detach(bob.id);
    expect([p.controller, p.state]).toEqual(['account', 'controlled']); // still theirs during the grace period
    timers.advance(30_001);
    expect([p.controller, p.state, p.pos.x, p.pos.z, p.owner]).toEqual(['ai', 'idle', 4, 5, bob.id]);
    for (let i = 0; i < 400; i++) stepSim(.05);
    expect(['doing', 'walking']).toContain(p.state);
  });

  it('the database saying "this is your desk" wins when the world did not know (a reset world)', async () => {
    const bob = await account('bob', 'desk:7');
    const p = deskPerson(7);
    expect(p.owner).toBeUndefined();
    expect(await manager.attach(bob)).toBe(p);
    expect([p.owner, p.name]).toEqual([bob.id, 'bob']);
  });

  it('plays as a guest, with a warning, if the desk is not available any more', async () => {
    const bob = await account('bob', 'desk:99');
    const g = await manager.attach(bob);
    expect(g.role).toBe('Guest');
    const carol = await account('carol', 'desk:8');
    deskPerson(8).owner = 12345; // somebody else's
    expect((await manager.attach(carol)).role).toBe('Guest');
  });

  it('wears the account\'s look when it has one', async () => {
    const bob = await account('bob', 'desk:5');
    deskPerson(5).owner = bob.id;
    await store.setSpec(bob.id, { hair: '#abcdef' });
    const p = await manager.attach((await store.byId(bob.id))!);
    expect(p.spec.hair).toBe('#abcdef');
  });

  it('releaseAll hands everybody back at once', async () => {
    const a = await account('a1'), b = await account('b1', 'desk:2');
    deskPerson(2).owner = b.id;
    const ga = await manager.attach(a), pb = await manager.attach(b);
    manager.releaseAll();
    expect(people).not.toContain(ga);
    expect(pb.controller).toBe('ai');
    expect(manager.online).toBe(0);
  });
});

describe('an admin giving a desk', () => {
  it('makes that desk person the account\'s: owner, name, saved in the account, announced', async () => {
    const ana = await account('ana');
    const before = deskPerson(10).name;
    const p = await manager.assignSlot(ana.id, 'desk:10');
    expect([p.owner, p.name]).toEqual([ana.id, 'ana']);
    expect(p.name).not.toBe(before);
    expect((await store.byId(ana.id))!.slotSpot).toBe('desk:10');
    expect(updated).toContain(p);
  });

  it('is refused for: no such account, an account with a desk, no such desk, an empty desk, Hazel, a claimed desk', async () => {
    const ana = await account('ana'), bob = await account('bob');
    expect(await code(manager.assignSlot(999, 'desk:3'))).toBe('no-account');
    expect(await code(manager.assignSlot(ana.id, 'desk:99'))).toBe('no-desk');
    expect(await code(manager.assignSlot(ana.id, 'chair:1'))).toBe('no-desk');
    const hazelDesk = interactables.of('desk').findIndex(d => (d.owner as Person)?.name === HAZEL_NAME);
    expect(await code(manager.assignSlot(ana.id, 'desk:' + hazelDesk))).toBe('reserved');
    await manager.assignSlot(ana.id, 'desk:3');
    expect(await code(manager.assignSlot(ana.id, 'desk:4'))).toBe('has-desk');
    expect(await code(manager.assignSlot(bob.id, 'desk:3'))).toBe('claimed');
  });

  it('a desk with nobody at it cannot be given (raise the slots first)', async () => {
    const ana = await account('ana');
    const empty = interactables.of('desk').find(d => !d.owner);
    expect(empty).toBeUndefined(); // the 40-desk test office is full: shrink it to make one
    const p = deskPerson(39);
    p.slot!.owner = null; people.splice(people.indexOf(p), 1);
    expect(await code(manager.assignSlot(ana.id, 'desk:39'))).toBe('no-person');
  });

  it('while the account is connected as a guest: the guest is removed and the connection told to log in again', async () => {
    const ana = await account('ana');
    const guest = await manager.attach(ana);
    await manager.assignSlot(ana.id, 'desk:11');
    expect(people).not.toContain(guest);
    expect(manager.isOnline(ana.id)).toBe(false);
    expect(kicks).toEqual([[ana.id, 'your desk was assigned, log in again']]);
    timers.advance(60_000); // and nothing is left to happen later
  });

  it('after which the account logs in and plays that person', async () => {
    const ana = await account('ana');
    const p = await manager.assignSlot(ana.id, 'desk:12');
    const got = await manager.attach((await store.byId(ana.id))!);
    expect(got).toBe(p);
    expect(got.controller).toBe('account');
  });
});

describe('an admin taking a desk back', () => {
  it('leaves the person as an ordinary NPC and frees the desk for someone else', async () => {
    const ana = await account('ana'), bob = await account('bob');
    const p = await manager.assignSlot(ana.id, 'desk:13');
    await manager.releaseSlot(ana.id);
    expect(p.owner).toBeUndefined();
    expect((await store.byId(ana.id))!.slotSpot).toBeNull();
    expect(p.controller).toBe('ai');
    expect((await manager.assignSlot(bob.id, 'desk:13')) === p).toBe(true); // the same person, now bob's
    expect(p.name).toBe('bob');
  });

  it('ends the play of an account that is playing that person right now', async () => {
    const ana = await account('ana');
    await manager.assignSlot(ana.id, 'desk:14');
    const p = await manager.attach((await store.byId(ana.id))!);
    await manager.releaseSlot(ana.id);
    expect([p.controller, p.state]).toEqual(['ai', 'idle']);
    expect(kicks).toEqual([[ana.id, 'your desk was taken away by an admin']]);
    expect(manager.isOnline(ana.id)).toBe(false);
  });

  it('is refused for an account with no desk or no account', async () => {
    const ana = await account('ana');
    expect(await code(manager.releaseSlot(ana.id))).toBe('has-no-desk');
    expect(await code(manager.releaseSlot(999))).toBe('no-account');
  });
});

describe('things that happen at the same time', () => {
  it('two admins giving the same account two different desks at once: one wins, the world and the database agree', async () => {
    const ana = await account('ana');
    const results = await Promise.all([code(manager.assignSlot(ana.id, 'desk:20')), code(manager.assignSlot(ana.id, 'desk:21'))]);
    expect(results.sort()).toEqual(['has-desk', 'ok']);
    expect(people.filter(p => p.owner === ana.id)).toHaveLength(1);
    const slot = (await store.byId(ana.id))!.slotSpot!;
    expect((interactables.of('desk').find(d => d.id === slot)!.owner as Person).owner).toBe(ana.id);
  });

  it('two accounts given the same desk at once: one wins', async () => {
    const a = await account('ana'), b = await account('bob');
    const results = await Promise.all([code(manager.assignSlot(a.id, 'desk:22')), code(manager.assignSlot(b.id, 'desk:22'))]);
    expect(results.sort()).toEqual(['claimed', 'ok']);
    expect(deskPerson(22).owner).toBeDefined();
  });

  it('a desk whose person is removed while it is being given out is not left assigned', async () => {
    const ana = await account('ana');
    const person = deskPerson(23);
    const real = store.setSlot.bind(store);
    store.setSlot = async (id, spot) => { const r = await real(id, spot); if (spot) { person.slot!.owner = null; people.splice(people.indexOf(person), 1); } return r; }; // the slot count was lowered meanwhile
    expect(await code(manager.assignSlot(ana.id, 'desk:23'))).toBe('no-person');
    store.setSlot = real;
    expect((await store.byId(ana.id))!.slotSpot).toBeNull(); // rolled back
    expect(updated).not.toContain(person); // viewers were not told about a ghost
  });

  it('a login that arrives while a desk is being taken away does not end up driving a person who is no longer theirs', async () => {
    const ana = await account('ana');
    await manager.assignSlot(ana.id, 'desk:24');
    const real = store.setSlot.bind(store);
    store.setSlot = async (id, spot) => { await new Promise(r => setTimeout(r, 30)); return real(id, spot); }; // the database is slow
    const stale = (await store.byId(ana.id))!; // what the gateway read before the release
    const [, played] = await Promise.all([manager.releaseSlot(ana.id), manager.attach(stale)]);
    store.setSlot = real;
    expect(played.slot === undefined || played.owner === ana.id).toBe(true); // a guest, or the person while it was still theirs
    expect(people.filter(p => p.owner === ana.id && p.slot)).toHaveLength(0); // nobody owned by her is left with a desk
    if (played.slot) expect(played.controller).toBe('ai'); // handed back by the release
    expect(kicks.length).toBeLessThanOrEqual(1);
  });

  it('Hazel can not be played or claimed even if the database says her desk belongs to an account', async () => {
    const hazelDesk = interactables.of('desk').findIndex(d => (d.owner as Person)?.name === HAZEL_NAME);
    const ana = await account('ana', 'desk:' + hazelDesk);
    const hazel = deskPerson(hazelDesk);
    const g = await manager.attach(ana);
    expect(g.role).toBe('Guest'); // playing as a guest instead
    expect(hazel.name).toBe(HAZEL_NAME);
    expect(hazel.owner).toBeUndefined();
    await manager.reconcile();
    expect(hazel.name).toBe(HAZEL_NAME);
    expect(hazel.owner).toBeUndefined();
  });
});

describe('giving a desk back', () => {
  it('gives the person an NPC name again, without using random numbers, and a release that finds nobody at the desk still succeeds', async () => {
    const ana = await account('ana');
    await manager.assignSlot(ana.id, 'desk:25');
    const p = deskPerson(25);
    expect(p.name).toBe('ana');
    const draws = drawCount();
    await manager.releaseSlot(ana.id);
    expect(p.name).not.toBe('ana');
    expect(drawCount()).toBe(draws);
    const bob = await account('bob', 'desk:26');
    deskPerson(26).owner = bob.id;
    const gone = deskPerson(26); gone.slot!.owner = null; people.splice(people.indexOf(gone), 1); // the person is gone
    await expect(manager.releaseSlot(bob.id)).resolves.toBeNull();
    expect((await store.byId(bob.id))!.slotSpot).toBeNull();
  });
});

describe('making the world agree with the accounts at start-up', () => {
  it('every account desk belongs to its person; a person claimed by an account that no longer has that desk is released', async () => {
    const a = await account('ana', 'desk:15'), b = await account('bob', 'desk:16');
    deskPerson(17).owner = 777; // a stale claim from a saved world: no account has desk 17
    deskPerson(16).owner = 999; // a claim by someone else on bob's desk: the accounts win
    const r = await manager.reconcile();
    expect(deskPerson(15).owner).toBe(a.id);
    expect(deskPerson(16).owner).toBe(b.id);
    expect(deskPerson(17).owner).toBeUndefined();
    expect(r).toEqual({ claimed: 2, released: 1 });
    expect(deskPerson(15).name).toBe('ana');
  });

  it('is quiet when everything already agrees, and survives an account whose desk has nobody', async () => {
    await account('ghost', 'desk:99');
    expect(await manager.reconcile()).toEqual({ claimed: 0, released: 0 });
  });
});
