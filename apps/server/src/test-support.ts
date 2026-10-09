import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, decode, encode, type Message } from '@office/shared';
import { AppModule } from './app.module';
import { configureApp } from './app.config';
import { MemoryAccountStore } from './auth/account-store';
import { AuthProvider } from './auth/auth.provider';
import { AuthService } from './auth/auth.service';

// Helpers for tests that run the real server (Nest, Socket.IO, the world) with accounts held in memory.

export const PASSWORD = 'correct-horse-battery';

export interface TestServer {
  app: INestApplication;
  base: string;
  store: MemoryAccountStore;
  auth: AuthService;
  close(): Promise<void>;
}

export async function bootTestServer(): Promise<TestServer> {
  delete process.env.DATABASE_URL;
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const store = new MemoryAccountStore();
  const auth = new AuthService(store, { limits: { registers: 10_000, logins: 10_000 } }); // many test accounts come from one address
  app.get(AuthProvider).useService(auth);
  return { app, base, store, auth, close: () => app.close() };
}

export interface Reply { status: number; body: any; setCookie: string | null } // eslint-disable-line @typescript-eslint/no-explicit-any
export async function api(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), setCookie: r.headers.get('set-cookie') };
}

/** Register the account (or log in if it exists) and return its session cookie. */
export async function sessionFor(base: string, username: string, password = PASSWORD): Promise<string> {
  let r = await api(base, 'POST', '/api/auth/register', { username, password });
  if (r.status === 409) r = await api(base, 'POST', '/api/auth/login', { username, password });
  if (!r.setCookie) throw new Error(`could not get a session for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.setCookie.split(';')[0];
}

/** A one-time ticket for the account behind this cookie. */
export async function ticketFor(base: string, cookie: string): Promise<string> {
  const r = await api(base, 'POST', '/api/play/ticket', undefined, { cookie });
  if (r.status !== 200) throw new Error(`no ticket: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.ticket;
}

export interface Client {
  socket: Socket;
  messages: Message[];
  ready: Promise<void>;
  waitFor<T extends Message>(pred: (m: Message) => m is T, ms?: number): Promise<T>;
  disconnected: Promise<string>;
}

export function connect(base: string): Client {
  const socket = io(base, { transports: ['websocket'], reconnection: false, forceNew: true });
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

export const hello = (c: Client, ticket: string, version = PROTOCOL_VERSION) => c.socket.emit('m', encode({ type: 'hello', version, ticket }));

/** Log the account in, get a ticket, and say hello with it. Returns the cookie too. */
export async function enter(base: string, c: Client, username: string): Promise<string> {
  const cookie = await sessionFor(base, username);
  hello(c, await ticketFor(base, cookie));
  return cookie;
}

export const isWelcome = (m: Message): m is Extract<Message, { type: 'welcome' }> => m.type === 'welcome';
export const isSnapshot = (m: Message): m is Extract<Message, { type: 'snapshot' }> => m.type === 'snapshot';
export const isKick = (m: Message): m is Extract<Message, { type: 'kick' }> => m.type === 'kick';
export const isPong = (m: Message): m is Extract<Message, { type: 'pong' }> => m.type === 'pong';
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
