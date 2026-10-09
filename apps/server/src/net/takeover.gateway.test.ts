import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSeed } from '@office/shared';
import { GameGateway } from './game.gateway';
import { PlayService } from '../play/play.service';
import { api, bootTestServer, connect, enter, isKick, isWelcome, sessionFor, sleep, ticketFor, hello, type Client, type TestServer } from '../test-support';
import type { Message } from '@office/shared';

// Taking over, handing back and guests, through real logins and real sockets, with an admin giving the desks out.

process.env.WORLD_SEED = '1';
process.env.GRACE_MS = '700';
process.env.ADMIN_TOKEN = 'admin-secret-for-tests';

const ADMIN = { authorization: 'Bearer admin-secret-for-tests' };
let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
const client = () => { const c = connect(base); open.push(c.socket); return c; };
const admin = (method: string, path: string, body?: unknown) => api(base, method, path, body, ADMIN);

beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

const accountId = (name: string) => [...server.store.accounts.values()].find(a => a.username === name)!.id;
const welcomeOf = (c: Client) => c.waitFor(isWelcome);
const updates = (c: Client, personId: number) => c.messages.filter((m): m is Extract<Message, { type: 'person' }> => m.type === 'person' && m.info.id === personId);
const lastController = (c: Client, personId: number): string | undefined => {
  const u = updates(c, personId); return u.length ? u[u.length - 1].info.controller : undefined;
};
const isLeave = (m: Message): m is Extract<Message, { type: 'leave' }> => m.type === 'leave';

type SlotRow = { spot: string; status: string; account: { username: string } | null; person: string };
const freeDesks = async (): Promise<string[]> => ((await admin('GET', '/api/admin/slots')).body as SlotRow[]).filter(s => s.status === 'unclaimed').map(s => s.spot);
const deskOf = new Map<string, string>();

/** Register an account and give it a free desk through the admin API (the office seats its people at random desks, so ask which are free). */
async function playerWithDesk(name: string, _hint?: string) {
  const cookie = await sessionFor(base, name);
  const [desk] = await freeDesks();
  const r = await admin('POST', `/api/admin/users/${accountId(name)}/assign-slot`, { spot: desk });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  deskOf.set(name, desk);
  return cookie;
}

describe('a player with a desk', () => {
  it('takes over their own person where it stands, and the welcome says which one is theirs', async () => {
    await playerWithDesk('dana', 'desk:3');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch1');
    const w0 = await welcomeOf(watcher);
    const before = w0.people.find(p => p.info.name === 'dana')!;
    expect(before.info.controller).toBe('ai'); // an NPC until she logs in: her desk person, already named for her
    const dana = client(); await dana.ready; await enter(base, dana, 'dana');
    const w = await welcomeOf(dana);
    expect(w.you).toBe(before.info.id);
    const me = w.people.find(p => p.info.id === w.you)!;
    expect(me.info).toMatchObject({ name: 'dana', controller: 'account' });
    expect([me.snap.x, me.snap.z]).toEqual([before.snap.x, before.snap.z].map(Math.fround)); // no teleport (to the precision of the wire)
    await sleep(400);
    expect(lastController(watcher, w.you)).toBe('account'); // everyone is told
    dana.socket.close(); watcher.socket.close();
  });

  it('when they leave, the person stays theirs for the grace period, then carries on by themselves', async () => {
    await playerWithDesk('erin', 'desk:4');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch2'); await welcomeOf(watcher);
    const erin = client(); await erin.ready; await enter(base, erin, 'erin');
    const id = (await welcomeOf(erin)).you;
    await sleep(300);
    erin.socket.close();
    await sleep(300); // inside the grace period
    expect(lastController(watcher, id)).toBe('account');
    await sleep(900); // after it
    expect(lastController(watcher, id)).toBe('ai');
    watcher.socket.close();
  });

  it('a reconnect inside the grace period resumes the same person with nothing in between', async () => {
    const cookie = await playerWithDesk('finn', 'desk:5');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch3'); await welcomeOf(watcher);
    const first = client(); await first.ready; hello(first, await ticketFor(base, cookie));
    const id = (await welcomeOf(first)).you;
    first.socket.close();
    await sleep(250);
    const second = client(); await second.ready; hello(second, await ticketFor(base, cookie));
    expect((await welcomeOf(second)).you).toBe(id);
    await sleep(1200); // well past the grace period of the first connection
    expect(updates(watcher, id).some(u => u.info.controller === 'ai')).toBe(false);
    second.socket.close(); watcher.socket.close();
  });

  it('a second tab takes over from the first without the person being handed back in between', async () => {
    const cookie = await playerWithDesk('gina', 'desk:6');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch4'); await welcomeOf(watcher);
    const one = client(); await one.ready; hello(one, await ticketFor(base, cookie));
    const id = (await welcomeOf(one)).you;
    const two = client(); await two.ready; hello(two, await ticketFor(base, cookie));
    expect((await one.waitFor(isKick)).reason).toMatch(/somewhere else/);
    expect((await welcomeOf(two)).you).toBe(id);
    await sleep(1300);
    expect(updates(watcher, id).some(u => u.info.controller === 'ai')).toBe(false);
    two.socket.close(); watcher.socket.close();
  });

  it('logging out ends the play, with the grace period', async () => {
    const cookie = await playerWithDesk('hugo', 'desk:7');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch5'); await welcomeOf(watcher);
    const c = client(); await c.ready; hello(c, await ticketFor(base, cookie));
    const id = (await welcomeOf(c)).you;
    await api(base, 'POST', '/api/auth/logout', undefined, { cookie });
    expect((await c.waitFor(isKick)).reason).toMatch(/logged out/);
    await sleep(1200);
    expect(lastController(watcher, id)).toBe('ai');
    watcher.socket.close();
  });
});

describe('a player with no desk yet', () => {
  it('is a guest: a new person at the entrance, seen by others, gone after the grace period', async () => {
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch6'); await welcomeOf(watcher);
    const guest = client(); await guest.ready; await enter(base, guest, 'visitor1');
    const w = await welcomeOf(guest);
    const me = w.people.find(p => p.info.id === w.you)!;
    expect(me.info).toMatchObject({ role: 'Guest', name: 'visitor1', controller: 'account', slot: -1 });
    await sleep(300);
    expect(watcher.messages.some(m => m.type === 'person' && m.info.id === w.you)).toBe(true);
    guest.socket.close();
    await sleep(1200);
    expect(watcher.messages.some(isLeave)).toBe(true);
    watcher.socket.close();
  });

  it('is told to log in again when an admin gives them a desk, and then plays that person', async () => {
    const cookie = await sessionFor(base, 'ivy');
    const c = client(); await c.ready; hello(c, await ticketFor(base, cookie));
    const guestId = (await welcomeOf(c)).you;
    const r = await admin('POST', `/api/admin/users/${accountId('ivy')}/assign-slot`, { spot: (await freeDesks())[0] });
    expect(r.status).toBe(201);
    expect((await c.waitFor(isKick)).reason).toMatch(/your desk was assigned/);
    const again = client(); await again.ready; hello(again, await ticketFor(base, cookie));
    const w = await welcomeOf(again);
    expect(w.you).not.toBe(guestId);
    expect(w.people.find(p => p.info.id === w.you)!.info).toMatchObject({ name: 'ivy', controller: 'account' });
    expect(w.people.some(p => p.info.id === guestId)).toBe(false); // the guest is gone
    again.socket.close();
  });

  it('losing a desk (an admin takes it) ends the play at once, and the person stays as an NPC', async () => {
    const cookie = await playerWithDesk('jack');
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch7'); await welcomeOf(watcher);
    const c = client(); await c.ready; hello(c, await ticketFor(base, cookie));
    const id = (await welcomeOf(c)).you;
    const r = await admin('POST', `/api/admin/users/${accountId('jack')}/release-slot`);
    expect(r.status).toBe(201);
    expect((await c.waitFor(isKick)).reason).toMatch(/taken away/);
    await sleep(300);
    expect(lastController(watcher, id)).toBe('ai');
    watcher.socket.close();
  });
});

describe('when something goes wrong while joining', () => {
  it('a join that fails after the person was taken over does not leave an orphaned session: they are handed back after the grace period', async () => {
    const cookie = await playerWithDesk('orphan');
    const gateway = server.app.get(GameGateway) as unknown as { broadcaster: { welcome: (...a: unknown[]) => Uint8Array } };
    const real = gateway.broadcaster.welcome.bind(gateway.broadcaster);
    const watcher = client(); await watcher.ready; await enter(base, watcher, 'watch8'); await welcomeOf(watcher);
    gateway.broadcaster.welcome = () => { throw new Error('boom'); }; // from now on a welcome cannot be built
    const c = client(); await c.ready; hello(c, await ticketFor(base, cookie));
    expect((await c.waitFor(isKick)).reason).toMatch(/server error/);
    gateway.broadcaster.welcome = real;
    const manager = server.app.get(PlayService).manager();
    const id = accountId('orphan');
    expect(manager.isOnline(id)).toBe(true); // within the grace period
    await sleep(1100);
    expect(manager.isOnline(id)).toBe(false); // not stuck online for ever
    const person = [...watcher.messages].reverse().find((m): m is Extract<Message, { type: 'person' }> => m.type === 'person' && m.info.name === 'orphan');
    expect(person?.info.controller).toBe('ai');
    watcher.socket.close();
  });
});

describe('the admin endpoints', () => {
  it('need the admin secret', async () => {
    expect((await api(base, 'GET', '/api/admin/users')).status).toBe(403);
    expect((await api(base, 'POST', '/api/admin/users/1/assign-slot', { spot: 'desk:1' })).status).toBe(403);
  });

  it('list users with whether they are playing, and desks with who has them', async () => {
    await sessionFor(base, 'lister');
    const users = (await admin('GET', '/api/admin/users')).body as Array<{ username: string; slotSpot: string | null; online: boolean }>;
    expect(users.find(u => u.username === 'lister')).toMatchObject({ slotSpot: null, online: false });
    expect(JSON.stringify(users)).not.toContain('argon2');
    const slots = (await admin('GET', '/api/admin/slots')).body as Array<{ spot: string; status: string; account: { username: string } | null; person: string }>;
    expect(slots).toHaveLength(40); // one per person; the other 30 desks of the real office are empty
    expect(slots.filter(s => s.status === 'reserved')).toHaveLength(1); // Hazel
    expect(slots.find(s => s.spot === deskOf.get('dana'))).toMatchObject({ status: 'claimed', account: { username: 'dana' }, person: 'dana' });
    expect(slots.some(s => s.status === 'unclaimed')).toBe(true);
  });

  it('answer 400, not a database error, for account ids that are not sensible', async () => {
    for (const id of ['99999999999', '0', '-1', '1e3', '1.5', 'abc', '2147483648']) {
      expect((await admin('POST', `/api/admin/users/${id}/release-slot`)).status, id).toBe(400);
    }
    expect((await admin('POST', '/api/admin/users/2147483647/release-slot')).status).toBe(404); // a valid id nobody has
  });

  it('refuse bad requests with the right answer', async () => {
    const id = accountId('lister');
    const slotsNow = (await admin('GET', '/api/admin/slots')).body as SlotRow[];
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, {})).status).toBe(400);
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: 'chair:1' })).status).toBe(400);
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: 'desk:77' })).status).toBe(400);
    const [free1, free2] = await freeDesks();
    expect((await admin('POST', `/api/admin/users/99999/assign-slot`, { spot: free1 })).status).toBe(404);
    expect((await admin('POST', `/api/admin/users/abc/assign-slot`, { spot: free1 })).status).toBe(400);
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: deskOf.get('dana') })).status).toBe(409); // dana's
    const empty = Array.from({ length: 70 }, (_, i) => 'desk:' + i).find(d => !(slotsNow.some(s => s.spot === d)))!;
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: empty })).status).toBe(409); // nobody sits there
    expect((await admin('POST', `/api/admin/users/${id}/release-slot`)).status).toBe(400); // has no desk
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: free1 })).status).toBe(201);
    expect((await admin('POST', `/api/admin/users/${id}/assign-slot`, { spot: free2 })).status).toBe(409); // already has one
  });
});
