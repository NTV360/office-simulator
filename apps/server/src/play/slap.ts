import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { SLAP_LATE, SLAP_ROUNDS, SLAP_TIME, koChance } from '@office/shared';
import { cleanChat } from './chat';

// Power Slap between people online (the browser side is apps/client/src/ui/slap.js), on the game's Socket.IO server.
// A connection says which employee it is ('slap:iam'); everyone sees who is online and can challenge them at any
// time. The challenge goes to that person (every tab they have open) and lapses unless they accept. Accepted fights
// are refereed here so everyone sees the same fight: whose turn it is, how hard each slap was (the slapper's power
// meter, or a weak slap when they take too long), knockouts and the winner. Each browser shows the fight with
// its own copies of the two employees.
// Who someone is is taken on trust, with one guard: the first browser to say it is an employee gets a token for
// them, and nobody else can be that employee while it is online (or for a while after it leaves). The events ride
// next to the binary 'm' channel: they are rare and JSON-shaped (invites carry names), so they stay plain Socket.IO.
const MAX_KEY = 80, MAX_NAME = 60;
const INVITE_MS = 20000; // a challenge lapses
const SPACING_MS = 3000; // between two challenges from one connection
const TABLES = 6; // the dining area's slap spots (apps/client/src/world/furniture/dining.js): at most this many fights at once
const MAX_INVITES = 50; // open challenges, all together
const RECLAIM_MS = 10 * 60000; // how long an employee stays reserved for their browser after it leaves
const ms = (s: number) => s * 1000;

type Who = { key: string; name: string };
type Invite = { id: number; from: Who; to: Who; timer: NodeJS.Timeout | null };
type Match = {
  id: number;
  a: Who;
  b: Who;
  table: number;
  slapper: 0 | 1;
  turn: number;
  power: [number, number];
  waiting: boolean;
  timer: NodeJS.Timeout | null;
};

const text = (raw: unknown, max: number): string => (cleanChat(raw) ?? '').slice(0, max);

export class SlapService {
  private readonly who = new Map<string, Who>(); // socket id → { key, name }
  private readonly invites = new Map<number, Invite>();
  private readonly matches = new Map<number, Match>();
  private readonly owners = new Map<string, { token: string; until: number }>(); // employee key → the browser that is that employee
  private nextId = 1;

  attach(io: Server): void {
    io.on('connection', socket => this.onConnection(io, socket));
  }

  private sockets(io: Server, key: string): Socket[] {
    return [...io.of('/').sockets.values()].filter(s => this.who.get(s.id)?.key === key);
  }
  private tell(io: Server, key: string, event: string, data: unknown): void {
    for (const s of this.sockets(io, key)) s.emit(event, data);
  }
  private fighting(key: string): boolean {
    return [...this.matches.values()].some(m => m.a.key === key || m.b.key === key);
  }
  private busy(key: string): boolean {
    return this.fighting(key) || [...this.invites.values()].some(i => i.from.key === key || i.to.key === key);
  }
  private list(): Array<Who & { busy: boolean }> {
    return [...new Map([...this.who.values()].map(w => [w.key, { ...w, busy: this.fighting(w.key) }])).values()];
  }
  private online(io: Server): void {
    io.emit('slap:online', this.list());
  }

  // When nobody is that employee any more, their browser keeps them reserved for a while.
  private free(io: Server, me: Who | undefined): void {
    if (me && !this.sockets(io, me.key).length && this.owners.has(me.key)) this.owners.get(me.key)!.until = Date.now() + RECLAIM_MS;
  }
  private closeInvite(io: Server, inv: Invite, why: string | null): void {
    if (inv.timer) clearTimeout(inv.timer);
    this.invites.delete(inv.id);
    this.tell(io, inv.to.key, 'slap:invite-closed', { id: inv.id });
    if (why) this.tell(io, inv.from.key, 'slap:declined', { id: inv.id, name: inv.to.name, why });
  }
  private start(io: Server, inv: Invite): void {
    const used = new Set([...this.matches.values()].map(m => m.table));
    const table = [...Array(TABLES).keys()].find(t => !used.has(t)) ?? Math.floor(Math.random() * TABLES);
    const first = Math.random() < 0.5 ? 0 : 1;
    const m: Match = { id: inv.id, a: inv.from, b: inv.to, table, slapper: first as 0 | 1, turn: 0, power: [0, 0], waiting: false, timer: null };
    this.matches.set(m.id, m);
    io.emit('slap:start', { id: m.id, a: m.a, b: m.b, table, first });
    m.timer = setTimeout(() => this.turn(io, m), ms(SLAP_TIME.gather));
    this.online(io);
  }
  private turn(io: Server, m: Match): void {
    m.waiting = true;
    io.emit('slap:turn', { id: m.id, slapper: m.slapper });
    m.timer = setTimeout(() => this.hit(io, m, SLAP_LATE), ms(SLAP_TIME.think));
  }
  private hit(io: Server, m: Match, power: number): void {
    if (m.timer) clearTimeout(m.timer);
    m.waiting = false;
    const ko = Math.random() < koChance(power);
    m.power[m.slapper] += power;
    m.turn++;
    io.emit('slap:hit', { id: m.id, power, ko });
    m.timer = setTimeout(() => {
      if (ko) return this.end(io, m, m.slapper, 'ko');
      if (m.turn >= SLAP_ROUNDS * 2) {
        const [a, b] = m.power;
        return this.end(io, m, a > b ? 0 : b > a ? 1 : null, a === b ? 'draw' : 'points');
      }
      m.slapper = (1 - m.slapper) as 0 | 1;
      this.turn(io, m);
    }, ms(SLAP_TIME.after));
  }
  private end(io: Server, m: Match, winner: 0 | 1 | null, how: string): void {
    if (m.timer) clearTimeout(m.timer);
    this.matches.delete(m.id);
    io.emit('slap:end', { id: m.id, winner, how });
    this.online(io);
  }

  private onConnection(io: Server, socket: Socket): void {
    socket.emit('slap:online', this.list());
    let lastChallenge = 0;
    socket.on('slap:iam', (me: { key?: unknown; name?: unknown; token?: unknown } | null, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (v: unknown) => void) : () => {};
      const was = this.who.get(socket.id);
      const key = text(me?.key, MAX_KEY), name = text(me?.name, MAX_NAME), token = text(me?.token, 64);
      if (was && was.key !== key && this.busy(was.key)) return reply({ ok: false, error: 'Finish your challenge or fight first' });
      if (!key || !name) {
        this.who.delete(socket.id);
        this.free(io, was);
        this.online(io);
        return reply({ ok: true });
      }
      const owner = this.owners.get(key);
      if (owner && owner.token !== token && (this.sockets(io, key).length || Date.now() < owner.until))
        return reply({ ok: false, error: `Someone else is online as ${name}` });
      const mine = owner?.token === token ? owner.token : randomUUID();
      this.owners.set(key, { token: mine, until: 0 });
      this.who.set(socket.id, { key, name });
      if (was?.key !== key) this.free(io, was);
      this.online(io);
      reply({ ok: true, token: mine });
    });
    socket.on('slap:challenge', (msg: { to?: unknown } | null, ack: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (v: unknown) => void) : () => {};
      const me = this.who.get(socket.id), to = text(msg?.to, MAX_KEY);
      const them = [...this.who.values()].find(w => w.key === to);
      if (!me) return reply({ ok: false, error: 'Pick who you are first' });
      if (!them) return reply({ ok: false, error: 'They are not online any more' });
      if (them.key === me.key) return reply({ ok: false, error: "You can't challenge yourself" });
      if (this.busy(me.key)) return reply({ ok: false, error: 'You already have a challenge or a fight going' });
      if (this.busy(them.key)) return reply({ ok: false, error: `${them.name} is busy, try again in a bit` });
      if (Date.now() - lastChallenge < SPACING_MS) return reply({ ok: false, error: 'Slow down a little' });
      if (this.invites.size >= MAX_INVITES) return reply({ ok: false, error: 'Too many open challenges, try again in a bit' });
      if (this.matches.size >= TABLES) return reply({ ok: false, error: 'All the tables are taken, try again in a bit' });
      lastChallenge = Date.now();
      const inv: Invite = { id: this.nextId++, from: me, to: them, timer: null };
      inv.timer = setTimeout(() => this.closeInvite(io, inv, 'did not answer'), INVITE_MS);
      this.invites.set(inv.id, inv);
      this.tell(io, them.key, 'slap:invite', { id: inv.id, from: me });
      reply({ ok: true });
    });
    socket.on('slap:answer', (msg: { id?: unknown; accept?: unknown } | null) => {
      const inv = this.invites.get(Number(msg?.id)), me = this.who.get(socket.id);
      if (!inv || me?.key !== inv.to.key) return;
      if (msg?.accept !== true) return this.closeInvite(io, inv, 'said no');
      if (this.matches.size >= TABLES) return this.closeInvite(io, inv, 'could not find a free table');
      this.closeInvite(io, inv, null);
      this.start(io, inv);
    });
    socket.on('slap:power', (msg: { id?: unknown; power?: unknown } | null) => {
      const m = this.matches.get(Number(msg?.id)), me = this.who.get(socket.id), power = Number(msg?.power);
      if (!m?.waiting || me?.key !== (m.slapper === 0 ? m.a : m.b).key || !Number.isFinite(power)) return;
      this.hit(io, m, Math.max(0, Math.min(1, power)));
    });
    socket.on('disconnect', () => {
      const me = this.who.get(socket.id);
      this.who.delete(socket.id);
      this.free(io, me);
      // their challenges lapse when this was their last tab; a fight goes on (their slaps come late and weak)
      if (me && !this.sockets(io, me.key).length)
        for (const inv of [...this.invites.values()]) {
          if (inv.to.key === me.key) this.closeInvite(io, inv, 'went offline');
          else if (inv.from.key === me.key) this.closeInvite(io, inv, null);
        }
      this.online(io);
    });
  }
}
