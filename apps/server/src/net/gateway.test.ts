import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, encode, setSeed } from '@office/shared';
import {
  bootTestServer, connect, enter, hello, isKick, isPong, isSnapshot, isWelcome, sessionFor, sleep, ticketFor, type TestServer,
} from '../test-support';

// The real server (Nest, Socket.IO, the world ticking) on a random port, with real socket clients that log in first.

process.env.WORLD_SEED = '1';
process.env.HELLO_TIMEOUT_MS = '400';
process.env.MAX_CLIENTS = '6';
process.env.GRACE_MS = '300';

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
const client = () => { const c = connect(base); open.push(c.socket); return c; };

beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); });

describe('the gateway', () => {
  it('sends the welcome after hello: the clock, the layout check, the 40 staff and you', async () => {
    const c = client();
    await c.ready;
    await enter(base, c, 'solo');
    const w = await c.waitFor(isWelcome);
    expect(w.people.filter(p => p.info.controller === 'ai')).toHaveLength(41); // the 40 staff and the helper
    const me = w.people.find(p => p.info.id === w.you)!;
    expect(me.info).toMatchObject({ controller: 'account', name: 'solo', role: 'Guest' }); // no desk yet: a guest at the entrance
    expect(w.layout.spots).toBe(158);
    expect(w).toMatchObject({ tickRate: 20, paused: false, speed: 1 });
    expect(w.people[0].info.name).toBe('Hazel Sellote');
    c.socket.close();
  });

  it('streams snapshots about every tick, and two viewers get the same ones', async () => {
    const a = client(), b = client();
    await Promise.all([a.ready, b.ready]);
    await enter(base, a, 'ann'); await enter(base, b, 'bob');
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    await sleep(1500);
    const sa = a.messages.filter(isSnapshot), sb = b.messages.filter(isSnapshot);
    expect(sa.length).toBeGreaterThan(20); // 20 ticks per second
    const byTick = new Map(sa.map(s => [s.tick, s]));
    let shared = 0;
    for (const s of sb) { const o = byTick.get(s.tick); if (o) { shared++; expect(o).toEqual(s); } }
    expect(shared).toBeGreaterThan(15);
    expect(sa[sa.length - 1].simTime).toBeGreaterThan(sa[0].simTime);
    expect(sa.some(s => s.full && s.people.length >= 41)).toBe(true); // a keyframe about once a second: the 40 staff and the two guests
    const deltas = sa.filter(s => !s.full);
    expect(deltas.length).toBeGreaterThan(10);
    const small = deltas.filter(s => s.people.length < 20).length;
    expect(small / deltas.length).toBeGreaterThan(0.8); // otherwise only the people who changed (the very first one after start-up can be large)
    a.socket.close(); b.socket.close();
  }, 15000);

  it('one viewer leaving does not disturb another', async () => {
    const a = client(), b = client();
    await Promise.all([a.ready, b.ready]);
    await enter(base, a, 'ann'); await enter(base, b, 'bob');
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    a.socket.close();
    const before = b.messages.filter(isSnapshot).length;
    await sleep(800);
    expect(b.messages.filter(isSnapshot).length).toBeGreaterThan(before + 3);
    b.socket.close();
  });

  it('answers a ping with the same timestamp', async () => {
    const c = client();
    await c.ready;
    await enter(base, c, 'pinger'); await c.waitFor(isWelcome);
    c.socket.emit('m', encode({ type: 'ping', ts: 123456.5 }));
    expect((await c.waitFor(isPong)).ts).toBe(123456.5);
    c.socket.close();
  });

  it('refuses a client with another protocol version', async () => {
    const c = client();
    await c.ready;
    const cookie = await sessionFor(base, 'oldclient');
    hello(c, await ticketFor(base, cookie), PROTOCOL_VERSION + 1);
    expect((await c.waitFor(isKick)).reason).toMatch(/version/);
    await c.disconnected;
  });

  it('drops a client that never says hello', async () => {
    const c = client();
    await c.ready;
    expect((await c.waitFor(isKick, 2000)).reason).toMatch(/hello/);
    await c.disconnected;
  });

  it('drops a client that sends garbage, text, or a message only the server may send', async () => {
    for (const payload of [new Uint8Array([9, 9, 9]), 'hello', encode({ type: 'pong', ts: 1 }), new Uint8Array(0)]) {
      const c = client();
      await c.ready;
      c.socket.emit('m', payload);
      await c.waitFor(isKick);
      await c.disconnected;
    }
  });

  it('a client who has not said hello receives no snapshots', async () => {
    const c = client();
    await c.ready;
    await sleep(300);
    expect(c.messages.filter(isSnapshot)).toHaveLength(0);
    c.socket.close();
  });

  it('refuses more clients than the limit', async () => {
    const many = Array.from({ length: 9 }, () => client());
    const results = await Promise.all(many.map(c => c.waitFor(isKick, 1500).then(() => 'kicked', () => 'ok')));
    expect(results.filter(r => r === 'kicked').length).toBeGreaterThanOrEqual(2);
    many.forEach(c => c.socket.close());
  }, 15000);
});

describe('the gateway under abuse', () => {
  it('drops a client that floods it, but not one that behaves', async () => {
    const flooder = client(), polite = client();
    await Promise.all([flooder.ready, polite.ready]);
    await enter(base, flooder, 'flooder'); await enter(base, polite, 'polite');
    await Promise.all([flooder.waitFor(isWelcome), polite.waitFor(isWelcome)]);
    for (let i = 0; i < 60; i++) flooder.socket.emit('m', encode({ type: 'ping', ts: i }));
    expect((await flooder.waitFor(isKick)).reason).toMatch(/too many/);
    await flooder.disconnected;
    polite.socket.emit('m', encode({ type: 'ping', ts: 1 }));
    expect((await polite.waitFor(isPong)).ts).toBe(1);
    polite.socket.close();
  });

  it('refuses server-only messages without parsing them, and the server keeps ticking', async () => {
    const c = client();
    await c.ready;
    c.socket.emit('m', encode({ type: 'kick', reason: 'x' }));
    expect((await c.waitFor(isKick)).reason).toMatch(/may send/);
    const watcher = client();
    await watcher.ready; await enter(base, watcher, 'watcher');
    await watcher.waitFor(isWelcome);
    await sleep(400);
    expect(watcher.messages.filter(isSnapshot).length).toBeGreaterThan(4);
    watcher.socket.close();
  });
});
