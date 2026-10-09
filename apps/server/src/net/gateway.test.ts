import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, decode, encode, setSeed, type Message, type Snapshot, type Welcome } from '@office/shared';
import { AppModule } from '../app.module';

// The real server (Nest, Socket.IO, the world ticking) on a random port, with real socket clients.

process.env.WORLD_SEED = '1';
process.env.HELLO_TIMEOUT_MS = '400';
process.env.MAX_CLIENTS = '6';

let app: INestApplication;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  url = `http://127.0.0.1:${addr.port}`;
}, 30000);
afterAll(async () => { open.forEach(s => s.close()); await app.close(); setSeed(null); });

interface Client {
  socket: Socket;
  messages: Message[];
  ready: Promise<void>;
  waitFor<T extends Message>(pred: (m: Message) => m is T, ms?: number): Promise<T>;
  disconnected: Promise<string>;
}

function connect(): Client {
  const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  open.push(socket);
  const messages: Message[] = [];
  socket.on('m', (data: ArrayBuffer | Uint8Array) => { messages.push(decode(new Uint8Array(data as ArrayBuffer))); });
  const disconnected = new Promise<string>(res => socket.on('disconnect', reason => res(reason)));
  const ready = new Promise<void>(res => socket.on('connect', () => res()));
  const waitFor = <T extends Message>(pred: (m: Message) => m is T, ms = 3000): Promise<T> => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      const hit = messages.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for a message'));
      setTimeout(check, 25);
    };
    check();
  });
  return { socket, messages, ready, waitFor, disconnected };
}
const hello = (c: Client, version = PROTOCOL_VERSION) => c.socket.emit('m', encode({ type: 'hello', version }));
const isWelcome = (m: Message): m is Welcome => m.type === 'welcome';
const isSnapshot = (m: Message): m is Snapshot => m.type === 'snapshot';
const isKick = (m: Message): m is Extract<Message, { type: 'kick' }> => m.type === 'kick';
const isPong = (m: Message): m is Extract<Message, { type: 'pong' }> => m.type === 'pong';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('the gateway', () => {
  it('sends the welcome after hello: the clock, the layout check and all 40 people', async () => {
    const c = connect();
    await c.ready;
    hello(c);
    const w = await c.waitFor(isWelcome);
    expect(w.people).toHaveLength(40);
    expect(w.layout.spots).toBe(145);
    expect(w).toMatchObject({ tickRate: 20, you: -1, paused: false, speed: 1 });
    expect(w.people[0].info.name).toBe('Hazel Sellote');
    c.socket.close();
  });

  it('streams snapshots about every tick, and two viewers get the same ones', async () => {
    const a = connect(), b = connect();
    await Promise.all([a.ready, b.ready]);
    hello(a); hello(b);
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    await sleep(1500);
    const sa = a.messages.filter(isSnapshot), sb = b.messages.filter(isSnapshot);
    expect(sa.length).toBeGreaterThan(20); // 20 ticks per second
    const byTick = new Map(sa.map(s => [s.tick, s]));
    let shared = 0;
    for (const s of sb) { const o = byTick.get(s.tick); if (o) { shared++; expect(o).toEqual(s); } }
    expect(shared).toBeGreaterThan(15);
    expect(sa[sa.length - 1].simTime).toBeGreaterThan(sa[0].simTime);
    expect(sa.some(s => s.full && s.people.length === 40)).toBe(true); // a keyframe about once a second
    const deltas = sa.filter(s => !s.full);
    expect(deltas.length).toBeGreaterThan(10);
    const small = deltas.filter(s => s.people.length < 20).length;
    expect(small / deltas.length).toBeGreaterThan(0.8); // otherwise only the people who changed (the very first one after start-up can be large)
    a.socket.close(); b.socket.close();
  }, 15000);

  it('one viewer leaving does not disturb another', async () => {
    const a = connect(), b = connect();
    await Promise.all([a.ready, b.ready]);
    hello(a); hello(b);
    await Promise.all([a.waitFor(isWelcome), b.waitFor(isWelcome)]);
    a.socket.close();
    const before = b.messages.filter(isSnapshot).length;
    await sleep(600);
    expect(b.messages.filter(isSnapshot).length).toBeGreaterThan(before + 5);
    b.socket.close();
  });

  it('answers a ping with the same timestamp', async () => {
    const c = connect();
    await c.ready;
    hello(c); await c.waitFor(isWelcome);
    c.socket.emit('m', encode({ type: 'ping', ts: 123456.5 }));
    expect((await c.waitFor(isPong)).ts).toBe(123456.5);
    c.socket.close();
  });

  it('refuses a client with another protocol version', async () => {
    const c = connect();
    await c.ready;
    hello(c, PROTOCOL_VERSION + 1);
    expect((await c.waitFor(isKick)).reason).toMatch(/version/);
    await c.disconnected;
  });

  it('drops a client that never says hello', async () => {
    const c = connect();
    await c.ready;
    expect((await c.waitFor(isKick, 2000)).reason).toMatch(/hello/);
    await c.disconnected;
  });

  it('drops a client that sends garbage, text, or a message only the server may send', async () => {
    for (const payload of [new Uint8Array([9, 9, 9]), 'hello', encode({ type: 'pong', ts: 1 }), new Uint8Array(0)]) {
      const c = connect();
      await c.ready;
      c.socket.emit('m', payload);
      await c.waitFor(isKick);
      await c.disconnected;
    }
  });

  it('a viewer who has not said hello receives no snapshots', async () => {
    const c = connect();
    await c.ready;
    await sleep(300);
    expect(c.messages.filter(isSnapshot)).toHaveLength(0);
    c.socket.close();
  });

  it('refuses more clients than the limit', async () => {
    const many = Array.from({ length: 9 }, () => connect());
    const results = await Promise.all(many.map(c => c.waitFor(isKick, 1500).then(() => 'kicked', () => 'ok')));
    expect(results.filter(r => r === 'kicked').length).toBeGreaterThanOrEqual(2);
    many.forEach(c => c.socket.close());
  }, 15000);
});

describe('the gateway under abuse', () => {
  it('drops a client that floods it, but not one that behaves', async () => {
    const flooder = connect(), polite = connect();
    await Promise.all([flooder.ready, polite.ready]);
    hello(flooder); hello(polite);
    await Promise.all([flooder.waitFor(isWelcome), polite.waitFor(isWelcome)]);
    for (let i = 0; i < 60; i++) flooder.socket.emit('m', encode({ type: 'ping', ts: i }));
    expect((await flooder.waitFor(isKick)).reason).toMatch(/too many/);
    await flooder.disconnected;
    polite.socket.emit('m', encode({ type: 'ping', ts: 1 }));
    expect((await polite.waitFor(isPong)).ts).toBe(1);
    polite.socket.close();
  });

  it('refuses server-only messages without parsing them, and the server keeps ticking', async () => {
    const c = connect();
    await c.ready;
    c.socket.emit('m', encode({ type: 'kick', reason: 'x' }));
    expect((await c.waitFor(isKick)).reason).toMatch(/may send/);
    const watcher = connect();
    await watcher.ready; hello(watcher);
    await watcher.waitFor(isWelcome);
    await sleep(400);
    expect(watcher.messages.filter(isSnapshot).length).toBeGreaterThan(4);
    watcher.socket.close();
  });
});
