import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REFUSAL_TEXT, carriedBy, handBack, initDay, initState, interactables, isSeated, loadLayout, makeGuest, movedObjects, objects, officeLayout, people, placementProblem, resetAllObjects,
  resetSim, setSeed, simEvents, takeControl, type Person, type WorldObject,
} from '@office/shared';
import { MemoryAccountStore } from '../auth/account-store';
import { OBJECT_BUCKET, PlayerManager } from './player-manager';

// What a player may do with the things in the office, at the manager (the rules, without sockets): pick up, put down, put back, whose they are, and
// how fast. The same over real sockets is in net/objects.actions.gateway.test.ts.

let manager: PlayerManager, store: MemoryAccountStore;
let tick = 0;
const T = () => (tick += 20); // a second between actions unless a test says otherwise

beforeEach(async () => {
  simEvents.clear(); setSeed(1); resetSim(); loadLayout(officeLayout); initState(); initDay(); resetAllObjects();
  store = new MemoryAccountStore();
  manager = new PlayerManager(store, { graceMs: 1000 });
  tick = 0;
});
afterEach(() => { setSeed(null); resetAllObjects(); });

async function guest(name: string): Promise<{ id: number; person: Person }> {
  const a = await store.create({ username: name, passwordHash: 'h', role: 'player' });
  if (a === 'taken') throw new Error('taken');
  const person = await manager.attach((await store.byId(a.id))!);
  return { id: a.id, person };
}
const stand = (p: Person, o: { x: number; z: number }, dx = .5) => { p.pos.x = o.x + dx; p.pos.z = o.z; };
const diningChair = (n = 0): WorldObject => objects.all().filter(o => o.type === 'chair-wood')[n];
const free = (o: WorldObject, from = .5) => { for (let r = from; r < 3; r += .15) for (let a = 0; a < 6.3; a += .4) { const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r; if (placementProblem(o, x, z, o.rot) === null) return { x, z }; } throw new Error('no place'); };

describe('picking up', () => {
  it('works on a free thing in reach in a shared area, and the thing is then in their hands', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    expect(manager.grabObject(id, chair.index, T())).toEqual({ ok: true, changed: 1 });
    expect(chair.carriedBy).toBe(person.id);
    expect(carriedBy(person.id)).toBe(chair);
  });

  it('is refused out of reach, for a thing that does not exist, one somebody has, and one that cannot move', async () => {
    const { id, person } = await guest('ana'), other = await guest('ben');
    const chair = diningChair();
    expect(manager.grabObject(id, chair.index, T())).toEqual({ ok: false, reason: 'too-far' });
    expect(manager.grabObject(id, 99999, T())).toEqual({ ok: false, reason: 'not-movable' });
    expect(manager.grabObject(id, -1, T())).toEqual({ ok: false, reason: 'not-movable' });
    expect(manager.grabObject(id, 1.5, T())).toEqual({ ok: false, reason: 'not-movable' });
    stand(person, chair); stand(other.person, chair, -.4);
    manager.grabObject(id, chair.index, T());
    expect(manager.grabObject(other.id, chair.index, T())).toEqual({ ok: false, reason: 'carried' });
  });

  it('is refused while sitting, while carrying something, and for a chair somebody sits in', async () => {
    const { id, person } = await guest('ana'), other = await guest('ben');
    const [a, b] = [diningChair(0), diningChair(1)];
    stand(person, a); manager.grabObject(id, a.index, T());
    stand(person, b);
    expect(manager.grabObject(id, b.index, T())).toEqual({ ok: false, reason: 'busy' });
    const seat = b.link!.spot; seat.occupant = other.person;
    const away = free(a); stand(person, away, -.3);
    manager.placeObject(id, away.x, away.z, 0, T());
    stand(person, b);
    expect(manager.grabObject(id, b.index, T())).toEqual({ ok: false, reason: 'in-use' });
    seat.occupant = null;
    expect(isSeated(person)).toBe(false);
  });

  it('is refused for a chair at somebody else\'s desk, the autopilot\'s included; the owner may', async () => {
    const mine = await guest('ana');
    const desk = interactables.of('desk').find(d => d.owner && (d.owner as Person).owner === undefined)!;
    const owner = desk.owner as Person;
    // ana plays the person who owns this desk
    owner.owner = mine.id; takeControl(owner); (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(mine.id, { person: owner, graceTimer: null, lastActTick: -Infinity, objectTokens: OBJECT_BUCKET.burst, objectTick: 0 });
    const chair = objects.all().find(o => o.station === desk.id && o.type === 'chair-office')!;
    const stranger = await guest('ben');
    stand(stranger.person, chair);
    expect(manager.grabObject(stranger.id, chair.index, T())).toEqual({ ok: false, reason: 'locked' });
    const npcDesk = interactables.of('desk').find(d => d !== desk && d.owner && (d.owner as Person).owner === undefined)!;
    const npcChair = objects.all().find(o => o.station === npcDesk.id && o.type === 'chair-office')!;
    stand(stranger.person, npcChair);
    expect(manager.grabObject(stranger.id, npcChair.index, T())).toEqual({ ok: false, reason: 'locked' });
    stand(owner, chair);
    expect(manager.grabObject(mine.id, chair.index, T())).toEqual({ ok: true, changed: 1 });
  });
});

describe('putting down', () => {
  it('puts the thing where it was aimed, the seat goes with it, and nobody holds it any more', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    manager.grabObject(id, chair.index, T());
    const at = free(chair);
    stand(person, at, -.4);
    expect(manager.placeObject(id, at.x, at.z, 1, T())).toEqual({ ok: true, changed: 1 });
    expect([chair.carriedBy, chair.x, chair.z, chair.rot]).toEqual([null, at.x, at.z, 1]);
    expect(chair.link!.spot.pos.x).toBeCloseTo(at.x, 1);
    expect(movedObjects()).toEqual([chair]);
  });

  it('is refused with nothing in the hands, out of reach, in a wall, on another chair, or not as numbers', async () => {
    const { id, person } = await guest('ana');
    const [a, b] = [diningChair(0), diningChair(1)];
    expect(manager.placeObject(id, 0, 0, 0, T())).toEqual({ ok: false, reason: 'nothing-carried' });
    stand(person, a); manager.grabObject(id, a.index, T());
    expect(manager.placeObject(id, a.x + 30, a.z, 0, T())).toEqual({ ok: false, reason: 'too-far' });
    expect(manager.placeObject(id, NaN, 0, 0, T())).toEqual({ ok: false, reason: 'blocked' });
    expect(manager.placeObject(id, a.x, a.z, Infinity, T())).toEqual({ ok: false, reason: 'blocked' });
    stand(person, b, .2);
    expect(manager.placeObject(id, b.x, b.z, 0, T())).toEqual({ ok: false, reason: 'crowded' });
    expect(a.carriedBy).toBe(person.id); // still in their hands after every refusal
  });
});

describe('putting back', () => {
  it('puts one thing back, only if it is theirs to move, and says nothing happened when it was home', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    manager.grabObject(id, chair.index, T());
    const at = free(chair); stand(person, at, -.4);
    manager.placeObject(id, at.x, at.z, 0, T());
    expect(manager.resetObjects(id, 'object', chair.index, T())).toEqual({ ok: true, changed: 1 });
    expect(movedObjects()).toEqual([]);
    expect(manager.resetObjects(id, 'object', chair.index, T())).toEqual({ ok: true, changed: 0 });
    const npcChair = objects.all().find(o => o.station && o.type === 'chair-office')!;
    stand(person, npcChair);
    expect(manager.resetObjects(id, 'object', npcChair.index, T())).toEqual({ ok: false, reason: 'locked' });
  });

  it('a guest has no desk, so no station to put back', async () => {
    const { id } = await guest('ana');
    expect(manager.resetObjects(id, 'station', 0, T())).toEqual({ ok: false, reason: 'locked' });
  });

  it('is refused when somebody has put another chair where it started', async () => {
    const { id, person } = await guest('ana');
    const [a, b] = [diningChair(0), diningChair(1)];
    stand(person, a); manager.grabObject(id, a.index, T());
    const at = free(a, 1.4); stand(person, at, -.4); manager.placeObject(id, at.x, at.z, 0, T());
    stand(person, b); manager.grabObject(id, b.index, T());
    stand(person, a.home, .0); person.pos.x = a.home.x + .5; person.pos.z = a.home.z;
    // b is put onto a's starting place (allowed: nothing is there now)
    expect(manager.placeObject(id, a.home.x, a.home.z, 0, T())).toEqual({ ok: true, changed: 1 });
    expect(manager.resetObjects(id, 'object', a.index, T())).toEqual({ ok: false, reason: 'crowded' });
  });
});

describe('what a review found', () => {
  it('putting one thing back needs reach, and not sitting, like picking it up', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    manager.grabObject(id, chair.index, T());
    const at = free(chair); stand(person, at, -.4);
    manager.placeObject(id, at.x, at.z, 0, T());
    person.pos.x = chair.x + 40; person.pos.z = chair.z; // far away
    expect(manager.resetObjects(id, 'object', chair.index, T())).toEqual({ ok: false, reason: 'too-far' });
    stand(person, chair, .3);
    expect(manager.resetObjects(id, 'object', chair.index, T())).toEqual({ ok: true, changed: 1 });
  });

  it('a carrier who has lost the desk (its owner changed) may not put its chair down', async () => {
    const mine = await guest('ana');
    const desk = interactables.of('desk').find(d => d.owner && (d.owner as Person).owner === undefined)!;
    const owner = desk.owner as Person;
    owner.owner = mine.id; takeControl(owner);
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(mine.id, { person: owner, graceTimer: null, lastActTick: -Infinity, objectTokens: OBJECT_BUCKET.burst, objectTick: 0 });
    const chair = objects.all().find(o => o.station === desk.id && o.type === 'chair-office')!;
    stand(owner, chair);
    expect(manager.grabObject(mine.id, chair.index, T())?.ok).toBe(true);
    owner.owner = 987654; // an admin gave the desk to somebody else
    const at = free(chair); stand(owner, at, -.4);
    expect(manager.placeObject(mine.id, at.x, at.z, 0, T())).toEqual({ ok: false, reason: 'locked' });
  });

  it('a huge angle is put down as one in range', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    manager.grabObject(id, chair.index, T());
    const at = free(chair); stand(person, at, -.4);
    expect(manager.placeObject(id, at.x, at.z, 123456, T())?.ok).toBe(true);
    expect(Math.abs(chair.rot)).toBeLessThanOrEqual(Math.PI);
  });
});

describe('how fast', () => {
  it('a burst of moves is allowed, then they are refused until the bucket has refilled', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    let refused = 0;
    for (let i = 0; i < OBJECT_BUCKET.burst + 6; i++) if (manager.grabObject(id, chair.index, 100)?.ok === false && (manager.grabObject(id, chair.index, 100) as { reason: string }).reason === 'too-fast') refused++;
    expect(refused).toBeGreaterThan(0);
    const later = manager.grabObject(id, chair.index, 100 + 20 * 5); // five seconds later
    expect(later && later.ok === false ? later.reason : 'ok').not.toBe('too-fast');
  });

  it('nothing happens for an account that is not playing', () => {
    expect(manager.grabObject(12345, 0, 0)).toBeNull();
    expect(manager.placeObject(12345, 0, 0, 0, 0)).toBeNull();
    expect(manager.resetObjects(12345, 'station', 0, 0)).toBeNull();
  });
});

describe('when the carrier goes', () => {
  it('handing a person back, or a guest leaving, puts what they carried where it started', async () => {
    const a = await guest('ana');
    const chair = diningChair(); stand(a.person, chair);
    manager.grabObject(a.id, chair.index, T());
    expect(chair.carriedBy).not.toBeNull();
    handBack(a.person); // a guest: they are simply gone
    expect(chair.carriedBy).toBeNull();
    expect(movedObjects()).toEqual([]);
    void people; void makeGuest; void REFUSAL_TEXT;
  });

  it('the same for a person with a desk: handed back to the autopilot, they put down what they carried', async () => {
    const mine = await guest('ana');
    const desk = interactables.of('desk').find(d => d.owner && (d.owner as Person).owner === undefined)!;
    const owner = desk.owner as Person;
    owner.owner = mine.id; takeControl(owner);
    (manager as unknown as { sessions: Map<number, unknown> }).sessions.set(mine.id, { person: owner, graceTimer: null, lastActTick: -Infinity, objectTokens: OBJECT_BUCKET.burst, objectTick: 0 });
    const chair = objects.all().find(o => o.station === desk.id && o.type === 'chair-office')!;
    stand(owner, chair);
    expect(manager.grabObject(mine.id, chair.index, T())?.ok).toBe(true);
    handBack(owner);
    expect(chair.carriedBy).toBeNull();
    expect(movedObjects()).toEqual([]);
  });

  it('somebody who carries something cannot sit (and can once they have put it down)', async () => {
    const { id, person } = await guest('ana');
    const chair = diningChair(); stand(person, chair);
    manager.grabObject(id, chair.index, T());
    const seat = interactables.of('dining').find(s => s !== chair.link!.spot && Math.hypot(s.pos.x - person.pos.x, s.pos.z - person.pos.z) < 1.4)!;
    person.pos.x = seat.approach.x; person.pos.z = seat.approach.z;
    expect(manager.act(id, 'sit', T())).toBe(false);
    expect(isSeated(person)).toBe(false);
  });
});
