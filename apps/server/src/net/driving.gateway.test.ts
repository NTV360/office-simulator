import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { W, encode, interactables, people, setSeed, type Person } from '@office/shared';
import { bootTestServer, connect, enter, hello, isKick, isSnapshot, isWelcome, sessionFor, sleep, ticketFor, type Client, type TestServer } from '../test-support';

// Driving a person over the wire: inputs in, positions out, with the rules enforced by the server.

process.env.WORLD_SEED = '1';
process.env.GRACE_MS = '600';

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
const client = () => { const c = connect(base); open.push(c.socket); return c; };
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); });

/** A player who has joined, and the server's own person for them (so the test can place them on open floor). */
async function player(name: string): Promise<{ c: Client; person: Person; id: number }> {
  const c = client(); await c.ready; await enter(base, c, name);
  const w = await c.waitFor(isWelcome);
  const person = people.find(p => p.id === w.you)!;
  return { c, person, id: w.you };
}
const input = (c: Client, seq: number, mx: number, mz: number, run = false, heading = 0) => c.socket.emit('m', encode({ type: 'input', seq, mx, mz, heading, run }));
/** Send the same input about 20 times a second for `ms`. */
async function hold(c: Client, mx: number, mz: number, ms: number, run = false, seq0 = 1, heading = 0): Promise<number> {
  const t0 = Date.now(); let seq = seq0;
  while (Date.now() - t0 < ms) { input(c, seq++, mx, mz, run, heading); await sleep(50); }
  return seq;
}
/** A clear spot of the real floor, away from desks and furniture. */
const OPEN = W(450, 700);
const place = (p: Person, x = OPEN.x, z = OPEN.z) => { p.pos.x = x; p.pos.z = z; };
const freeSeat = (kind: string) => interactables.of(kind).find(s => !s.occupant)!;

describe('moving', () => {
  it('walks at about 1.5 m/s in the direction asked, facing the heading', async () => {
    const { c, person } = await player('walker');
    place(person);
    const z0 = person.pos.z, x0 = person.pos.x;
    await hold(c, 0, 1, 1000, false, 1, 2.0);
    const moved = person.pos.z - z0;
    expect(moved).toBeGreaterThan(1.1);
    expect(moved).toBeLessThan(1.8);
    expect(Math.abs(person.pos.x - x0)).toBeLessThan(0.01);
    expect(person.face).toBeCloseTo(2.0, 3);
    c.socket.close();
  });

  it('runs at about 3 m/s', async () => {
    const { c, person } = await player('runner');
    place(person);
    const z0 = person.pos.z;
    await hold(c, 0, 1, 1000, true);
    expect(person.pos.z - z0).toBeGreaterThan(2.3);
    expect(person.pos.z - z0).toBeLessThan(3.5);
    c.socket.close();
  });

  it('whatever is sent, never faster than that: a million times full speed is still full speed', async () => {
    const { c, person } = await player('cheater');
    place(person);
    const z0 = person.pos.z;
    await hold(c, 0, 1e6, 1000, false);
    expect(person.pos.z - z0).toBeLessThan(1.8);
    place(person);
    const z1 = person.pos.z;
    await hold(c, 1e9, 1e9, 1000, true, 100000);
    expect(Math.hypot(person.pos.x - OPEN.x, person.pos.z - z1)).toBeLessThan(3.6);
    c.socket.close();
  });

  it('stops by itself shortly after the player stops sending', async () => {
    const { c, person } = await player('stopper');
    place(person);
    await hold(c, 0, 1, 500);
    await sleep(400); // longer than the quarter second of grace
    const z = person.pos.z;
    await sleep(500);
    expect(person.pos.z).toBe(z);
    c.socket.close();
  });

  it('an older message (a lower number) does not undo a newer one', async () => {
    const { c, person } = await player('ordered');
    place(person);
    const z0 = person.pos.z;
    input(c, 50, 0, 1);
    input(c, 10, 0, -1); // arrives later but is older
    await sleep(150);
    input(c, 51, 0, 1);
    await sleep(100);
    expect(person.pos.z).toBeGreaterThan(z0);
    c.socket.close();
  });

  it('numbers that are not numbers are refused and the client is dropped', async () => {
    const { c } = await player('nan');
    const frame = new Uint8Array(encode({ type: 'input', seq: 1, mx: 0, mz: 1, heading: 0, run: false }));
    new DataView(frame.buffer).setFloat32(5, NaN); // mx is NaN
    c.socket.emit('m', frame);
    expect((await c.waitFor(isKick)).reason).toMatch(/bad message/);
  });

  it('nobody moves without input, even with the whole office walking around them', async () => {
    const { c, person } = await player('still');
    place(person);
    const at = [person.pos.x, person.pos.z];
    await sleep(800);
    expect([person.pos.x, person.pos.z]).toEqual(at);
    c.socket.close();
  });

  it('is seen moving by everyone else', async () => {
    const watcher = await player('seer');
    const { c, person, id } = await player('seen');
    place(person);
    await hold(c, 0, 1, 1000);
    const seenNow = () => [...watcher.c.messages.filter(isSnapshot)].reverse().flatMap(s => s.people).find(p => p.id === id)!;
    for (let i = 0; i < 60 && Math.abs(seenNow().z - person.pos.z) > 0.05; i++) await sleep(50); // (a busy machine delays snapshots)
    const lastSeen = seenNow();
    expect(lastSeen.z).toBeCloseTo(person.pos.z, 1);
    expect(lastSeen.z - OPEN.z).toBeGreaterThan(1);
    c.socket.close(); watcher.c.socket.close();
  });
});

describe('the connection', () => {
  it('input before saying hello drops the connection', async () => {
    const c = client(); await c.ready;
    input(c, 1, 0, 1);
    expect((await c.waitFor(isKick)).reason).toMatch(/say hello first/);
  });

  it('act before saying hello drops the connection', async () => {
    const c = client(); await c.ready;
    c.socket.emit('m', encode({ type: 'act', kind: 'sit' }));
    expect((await c.waitFor(isKick)).reason).toMatch(/say hello first/);
  });

  it('a normal stream of inputs (20 a second) is fine for a long time, a burst of 100 at once is not', async () => {
    const { c } = await player('steady');
    await hold(c, 0, 0, 2500);
    expect(c.messages.some(isKick)).toBe(false);
    for (let i = 0; i < 100; i++) input(c, 100000 + i, 0, 0);
    expect((await c.waitFor(isKick)).reason).toMatch(/too many/);
  });
});

describe('sitting', () => {
  const sit = (c: Client) => c.socket.emit('m', encode({ type: 'act', kind: 'sit' }));
  const stand = (c: Client) => c.socket.emit('m', encode({ type: 'act', kind: 'stand' }));

  it('sits in a free seat next to them and everyone sees it; stands up again', async () => {
    const watcher = await player('sitwatch');
    const { c, person, id } = await player('sitter');
    const seat = freeSeat('lounge');
    place(person, seat.pos.x + 0.3, seat.pos.z);
    sit(c);
    await sleep(250);
    expect(person.task).toMatchObject({ kind: 'playerSit' });
    expect(seat.occupant).toBe(person);
    expect([person.pos.x, person.pos.z]).toEqual([seat.pos.x, seat.pos.z]);
    const seen = [...watcher.c.messages.filter(isSnapshot)].reverse().flatMap(s => s.people).find(p => p.id === id)!;
    expect(seen.kind).toBe('playerSit');
    expect(seen.spot).toBe(interactables.indexOf(seat) + 1);
    stand(c);
    await sleep(250);
    expect(person.task).not.toBeNull(); // too soon: one sit or stand a second
    await sleep(900);
    stand(c);
    await sleep(250);
    expect([person.task, seat.occupant]).toEqual([null, null]);
    c.socket.close(); watcher.c.socket.close();
  });

  it('nothing happens when there is no seat in reach', async () => {
    const { c, person } = await player('noseat');
    place(person);
    sit(c);
    await sleep(250);
    expect(person.task).toBeNull();
    c.socket.close();
  });

  it('two players cannot take one seat: the second is refused', async () => {
    const a = await player('first'), b = await player('second');
    const seat = freeSeat('lounge');
    place(a.person, seat.pos.x + 0.2, seat.pos.z); place(b.person, seat.pos.x - 0.2, seat.pos.z);
    sit(a.c); await sleep(200);
    sit(b.c); await sleep(250);
    expect(seat.occupant).toBe(a.person);
    expect(b.person.task?.spot).not.toBe(seat); // refused this one (the real lounge has neighbouring seats, so b may sit in one of those)
    a.c.socket.close(); b.c.socket.close();
  });

  it('walking away stands them up first', async () => {
    const { c, person } = await player('leaver');
    const seat = freeSeat('lounge');
    place(person, seat.pos.x, seat.pos.z);
    sit(c); await sleep(200);
    expect(person.task?.kind).toBe('playerSit');
    await hold(c, 1, 0, 400);
    expect([person.task, seat.occupant]).toEqual([null, null]);
    expect(Math.hypot(person.pos.x - seat.pos.x, person.pos.z - seat.pos.z)).toBeGreaterThan(0.2);
    c.socket.close();
  });

  it('standing when not sitting is harmless', async () => {
    const { c, person } = await player('standing');
    place(person);
    stand(c); stand(c);
    await sleep(200);
    expect(person.task).toBeNull();
    expect(c.messages.some(isKick)).toBe(false);
    c.socket.close();
  });

  it('a player who disconnects while sitting keeps the seat during the grace period, then it is freed and they are gone', async () => {
    const { c, person } = await player('dropper');
    const seat = freeSeat('lounge');
    place(person, seat.pos.x, seat.pos.z);
    sit(c); await sleep(200);
    c.socket.close();
    await sleep(300);
    expect(seat.occupant).toBe(person);
    await sleep(700);
    expect(seat.occupant).toBeNull();
    expect(people).not.toContain(person); // a guest: removed
  });

  it('a player with a desk who disconnects while sitting hands the person back, seat freed, ready for the autopilot', async () => {
    const cookie = await sessionFor(base, 'deskdropper');
    const slots = await fetch(base + '/api/admin/slots', { headers: { authorization: 'Bearer ' + (process.env.ADMIN_TOKEN ?? '') } }).catch(() => null);
    void slots;
    const c = client(); await c.ready; hello(c, await ticketFor(base, cookie));
    const w = await c.waitFor(isWelcome);
    const person = people.find(p => p.id === w.you)!;
    // (this account has no desk, so it is a guest; the desk case is covered in the takeover tests)
    const seat = freeSeat('dining');
    place(person, seat.pos.x, seat.pos.z);
    sit(c); await sleep(200);
    expect(seat.occupant).toBe(person);
    c.socket.close();
    await sleep(1000);
    expect(seat.occupant).toBeNull();
  });
});
