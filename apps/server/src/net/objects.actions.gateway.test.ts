import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NONE, REFUSAL_TEXT, encode, movedObjects, objects, people, placementProblem, resetAllObjects, setSeed, sim, type ClientMessage, type Message, type Person, type WorldObject,
} from '@office/shared';
import { api, bootTestServer, connect, enter, isWelcome, sessionFor, sleep, type Client, type TestServer } from '../test-support';

// Picking things up, putting them down and putting them back, through real logins and real sockets: what works tells everybody, and
// what is refused tells only the player why. See docs/PHASE-5-BREAKDOWN.md, step 4.

process.env.WORLD_SEED = '1';
process.env.GRACE_MS = '600';
process.env.ADMIN_TOKEN = 'admin-secret-for-tests';
const ADMIN = { authorization: 'Bearer admin-secret-for-tests' };

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); resetAllObjects(); await server.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

const objectMessages = (c: Client, index?: number) => c.messages.filter((m): m is Extract<Message, { type: 'object' }> => m.type === 'object' && (index === undefined || m.pose.index === index));
const notices = (c: Client) => c.messages.filter((m): m is Extract<Message, { type: 'event' }> => m.type === 'event' && m.kind === 'notice').map(m => m.text);
const send = (c: Client, m: ClientMessage) => c.socket.emit('m', encode(m));
const personOf = (name: string): Person => people.find(p => p.name === name)!;
const accountId = (name: string) => [...server.store.accounts.values()].find(a => a.username === name)!.id;
const admin = (method: string, path: string, body?: unknown) => api(base, method, path, body, ADMIN);

async function join(name: string): Promise<Client> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  await c.waitFor(isWelcome);
  return c;
}
/** An account with a desk of its own, logged in. Returns the client and the desk's spot id. */
async function deskPlayer(name: string): Promise<{ c: Client; desk: string }> {
  await sessionFor(base, name);
  const free = ((await admin('GET', '/api/admin/slots')).body as Array<{ spot: string; status: string }>).filter(s => s.status === 'unclaimed')[0].spot;
  expect((await admin('POST', `/api/admin/users/${accountId(name)}/assign-slot`, { spot: free })).status).toBe(201);
  return { c: await join(name), desk: free };
}
/** Stand a player's person next to something (the test does not walk there). */
const stand = (name: string, o: { x: number; z: number }, dx = .6) => { const p = personOf(name); p.pos.x = o.x + dx; p.pos.z = o.z; };

const diningChair = (n = 0): WorldObject => objects.all().filter(o => o.type === 'chair-wood')[n];
const freePlaceNear = (o: WorldObject, from = .5) => {
  for (let r = from; r < 3; r += .15) for (let a = 0; a < 6.3; a += .4) { const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r; if (placementProblem(o, x, z, o.rot) === null) return { x, z }; }
  throw new Error('no free place');
};

describe('picking up and putting down', () => {
  it('a player picks up a chair in a shared area: everybody is told it is in their hands, and when it is put down, where', async () => {
    resetAllObjects();
    const a = await join('obj_a'), b = await join('obj_b');
    const chair = diningChair(0);
    stand('obj_a', chair);
    send(a, { type: 'grab', object: chair.index });
    await sleep(300);
    const carrier = personOf('obj_a').id;
    for (const who of [a, b]) expect(objectMessages(who, chair.index).map(m => m.pose.carriedBy)).toEqual([carrier]);
    expect(chair.carriedBy).toBe(carrier);
    const spot = freePlaceNear(chair, 1.2);
    stand('obj_a', spot, .5);
    send(a, { type: 'place', x: spot.x, z: spot.z, rot: 1.5 });
    await sleep(300);
    for (const who of [a, b]) {
      const last = objectMessages(who, chair.index).at(-1)!.pose;
      expect([last.carriedBy, +last.x.toFixed(2), +last.z.toFixed(2)]).toEqual([NONE, +spot.x.toFixed(2), +spot.z.toFixed(2)]);
    }
    expect(chair.carriedBy).toBeNull();
    expect(movedObjects().map(o => o.id)).toEqual([chair.id]);
    expect(chair.link!.spot.pos.x).toBeCloseTo(spot.x, 1); // the seat came with it
    a.socket.close(); b.socket.close();
    resetAllObjects();
  });

  it('is refused, with the reason to that player alone, when it is too far, carried, fixed, or not a thing', async () => {
    resetAllObjects();
    const a = await join('obj_far'), b = await join('obj_other');
    const chair = diningChair(1);
    send(a, { type: 'grab', object: chair.index }); // (guests start at the entrance, far from the dining chairs)
    send(a, { type: 'grab', object: 60000 });
    await sleep(300);
    expect(notices(a)).toEqual([REFUSAL_TEXT['too-far'], REFUSAL_TEXT['not-movable']]);
    expect(notices(b)).toEqual([]);
    expect(objectMessages(a)).toEqual([]);
    stand('obj_other', chair); send(b, { type: 'grab', object: chair.index }); await sleep(250);
    stand('obj_far', chair); send(a, { type: 'grab', object: chair.index }); await sleep(250);
    expect(notices(a).at(-1)).toBe(REFUSAL_TEXT.carried);
    a.socket.close(); b.socket.close();
    resetAllObjects();
  });

  it('a place that is not allowed is refused and nothing moves: a wall, nothing carried, out of reach, off the numbers', async () => {
    resetAllObjects();
    const a = await join('obj_place');
    const chair = diningChair(2);
    send(a, { type: 'place', x: chair.x, z: chair.z, rot: 0 }); await sleep(150);
    expect(notices(a).at(-1)).toBe(REFUSAL_TEXT['nothing-carried']);
    stand('obj_place', chair); send(a, { type: 'grab', object: chair.index }); await sleep(200);
    send(a, { type: 'place', x: chair.x + 30, z: chair.z, rot: 0 }); await sleep(150);
    expect(notices(a).at(-1)).toBe(REFUSAL_TEXT['too-far']);
    const p = personOf('obj_place');
    let blocked: { x: number; z: number } | null = null; // somewhere in reach that is not floor (a dining table, say)
    for (let r = .4; r < 2.4 && !blocked; r += .1) for (let ang = 0; ang < 6.3 && !blocked; ang += .3) { const x = p.pos.x + Math.cos(ang) * r, z = p.pos.z + Math.sin(ang) * r; if (placementProblem(chair, x, z, 0) === 'blocked') blocked = { x, z }; }
    expect(blocked, 'there is a table or a wall within reach of a dining chair').not.toBeNull();
    send(a, { type: 'place', x: blocked!.x, z: blocked!.z, rot: 0 }); await sleep(150);
    expect(notices(a).at(-1)).toBe(REFUSAL_TEXT.blocked);
    expect(chair.carriedBy).toBe(p.id); // still in their hands
    a.socket.close(); await sleep(900); // (the grace period ends and they leave)
    expect(chair.carriedBy).toBeNull();
    resetAllObjects();
  });

  it('a person who carries something cannot sit, and cannot pick up a second thing', async () => {
    resetAllObjects();
    const a = await join('obj_busy');
    const [c1, c2] = [diningChair(3), diningChair(4)];
    stand('obj_busy', c1); send(a, { type: 'grab', object: c1.index }); await sleep(200);
    send(a, { type: 'act', kind: 'sit' }); await sleep(150);
    expect(personOf('obj_busy').task).toBeNull();
    stand('obj_busy', c2); send(a, { type: 'grab', object: c2.index }); await sleep(150);
    expect(notices(a).at(-1)).toBe(REFUSAL_TEXT.busy);
    expect(c2.carriedBy).toBeNull();
    a.socket.close(); await sleep(900);
    resetAllObjects();
  });

  it('a chair somebody sits in cannot be picked up', async () => {
    resetAllObjects();
    const a = await join('obj_sitter'), b = await join('obj_picker');
    const chair = diningChair(5), seat = chair.link!.spot;
    { const p = personOf('obj_sitter'); p.pos.x = seat.approach.x; p.pos.z = seat.approach.z; } send(a, { type: 'act', kind: 'sit' }); await sleep(250);
    expect(seat.occupant).toBe(personOf('obj_sitter'));
    stand('obj_picker', chair); send(b, { type: 'grab', object: chair.index }); await sleep(200);
    expect(notices(b).at(-1)).toBe(REFUSAL_TEXT['in-use']);
    a.socket.close(); b.socket.close(); await sleep(900);
    resetAllObjects();
  });

  it('too many moves too quickly are refused (the bucket), and it refills', async () => {
    resetAllObjects();
    const a = await join('obj_spam');
    const chair = diningChair(6);
    stand('obj_spam', chair);
    for (let i = 0; i < 14; i++) send(a, { type: 'grab', object: chair.index });
    await sleep(400);
    expect(notices(a).filter(t => t === REFUSAL_TEXT['too-fast']).length).toBeGreaterThan(0);
    await sleep(1500);
    send(a, { type: 'place', x: chair.x + 1.2, z: chair.z, rot: 0 }); await sleep(200);
    expect(notices(a).at(-1)).not.toBe(REFUSAL_TEXT['too-fast']);
    a.socket.close(); await sleep(900);
    resetAllObjects();
  });
});

describe('whose things they are', () => {
  it('the chair at a desk is the desk owner\'s to move: nobody else may, and not while it belongs to the autopilot either', async () => {
    resetAllObjects();
    const { c: owner, desk } = await deskPlayer('obj_owner');
    const other = await join('obj_guest');
    const chair = objects.all().find(o => o.station === desk && o.type === 'chair-office')!;
    stand('obj_guest', chair); send(other, { type: 'grab', object: chair.index }); await sleep(200);
    expect(notices(other).at(-1)).toBe(REFUSAL_TEXT.locked);
    expect(chair.carriedBy).toBeNull();
    // a desk nobody plays: the autopilot's, locked too
    const npcChair = objects.all().find(o => o.station && o.station !== desk && (people.find(p => p.slot?.id === o.station)?.owner === undefined) && o.type === 'chair-office')!;
    stand('obj_guest', npcChair); send(other, { type: 'grab', object: npcChair.index }); await sleep(200);
    expect(notices(other).at(-1)).toBe(REFUSAL_TEXT.locked);
    // the owner may
    stand('obj_owner', chair); send(owner, { type: 'grab', object: chair.index }); await sleep(250);
    expect(chair.carriedBy).toBe(personOf('obj_owner').id);
    const spot = freePlaceNear(chair, .5);
    stand('obj_owner', spot, .4); send(owner, { type: 'place', x: spot.x, z: spot.z, rot: 0 }); await sleep(250);
    expect(Math.hypot(chair.x - chair.home.x, chair.z - chair.home.z)).toBeGreaterThan(.3);
    // and a small thing on the desk, within the desk
    const mug = objects.all().find(o => o.station === desk && o.type === 'mug');
    if (mug) {
      stand('obj_owner', mug, .5); send(owner, { type: 'grab', object: mug.index }); await sleep(250);
      send(owner, { type: 'place', x: mug.x + .02, z: mug.z, rot: 0 }); await sleep(250);
      expect(mug.carriedBy).toBeNull();
    }
    owner.socket.close(); other.socket.close(); await sleep(900);
    resetAllObjects();
  });

  it('"reset my station" puts everything at the desk back, and "reset" of one thing only for who may move it', async () => {
    resetAllObjects();
    const { c: owner, desk } = await deskPlayer('obj_tidy');
    const chair = objects.all().find(o => o.station === desk && o.type === 'chair-office')!;
    stand('obj_tidy', chair); send(owner, { type: 'grab', object: chair.index }); await sleep(250);
    const spot = freePlaceNear(chair, .5); stand('obj_tidy', spot, .4);
    send(owner, { type: 'place', x: spot.x, z: spot.z, rot: 0 }); await sleep(250);
    expect(movedObjects().some(o => o === chair)).toBe(true);
    send(owner, { type: 'reset', scope: 'station', object: NONE }); await sleep(250);
    expect(movedObjects()).toEqual([]);
    send(owner, { type: 'reset', scope: 'station', object: NONE }); await sleep(200);
    expect(notices(owner).at(-1)).toBe('Your desk is already as it started.');
    // not somebody else's thing
    const theirs = objects.all().find(o => o.station && o.station !== desk && o.type === 'chair-office')!;
    stand('obj_tidy', theirs); send(owner, { type: 'reset', scope: 'object', object: theirs.index }); await sleep(200);
    expect(notices(owner).at(-1)).toBe(REFUSAL_TEXT.locked);
    owner.socket.close(); await sleep(900);
    resetAllObjects();
  });

  it('a guest with no desk has no station to reset', async () => {
    const g = await join('obj_nodesk');
    send(g, { type: 'reset', scope: 'station', object: NONE }); await sleep(200);
    expect(notices(g).at(-1)).toBe(REFUSAL_TEXT.locked);
    g.socket.close(); await sleep(900);
  });
});

describe('when the carrier goes', () => {
  it('what they carry goes back where it started, and everybody is told', async () => {
    resetAllObjects();
    const a = await join('obj_leaver'), watcher = await join('obj_watch');
    const chair = diningChair(7);
    stand('obj_leaver', chair); send(a, { type: 'grab', object: chair.index }); await sleep(250);
    expect(chair.carriedBy).not.toBeNull();
    a.socket.close();
    await sleep(1200); // the grace period (600 ms) and a little more
    expect(chair.carriedBy).toBeNull();
    expect(movedObjects()).toEqual([]);
    const poses = objectMessages(watcher, chair.index).map(m => m.pose.carriedBy);
    expect(poses.at(-1)).toBe(NONE);
    watcher.socket.close();
    void sim;
  });
});
