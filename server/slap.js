import { randomUUID } from 'node:crypto';
import { SLAP_LATE, SLAP_ROUNDS, SLAP_TIME, koChance } from '../src/config/slap.js';
import { clean as text } from './chat.js';

// Power Slap between people online (the browser side is src/ui/slap.js), on the chat's Socket.IO server.
// A connection says which employee it is ('slap:iam'); everyone sees who is online and can challenge them at any
// time. The challenge goes to that person (every tab they have open) and lapses unless they accept. Accepted fights
// are refereed here so everyone sees the same fight: whose turn it is, how hard each slap was (the slapper's power
// meter, or a weak slap when they take too long), knockouts and the winner. Each browser shows the fight with
// its own copies of the two employees.
// There is no sign-in, so who someone is is taken on trust, with one guard: the first browser to say it is an employee
// gets a token for them, and nobody else can be that employee while it is online (or for a while after it leaves).
const MAX_KEY = 80, MAX_NAME = 60;
const INVITE_MS = 20000;  // a challenge lapses
const SPACING_MS = 3000;  // between two challenges from one connection
const TABLES = 6;         // the dining area's slap spots (world/furniture/dining.js): at most this many fights at once
const MAX_INVITES = 50;   // open challenges, all together
const RECLAIM_MS = 10 * 60000; // how long an employee stays reserved for their browser after it leaves
const ms = s => s * 1000;

function attachSlap(io) {
  const who = new Map();     // socket id → { key, name }
  const invites = new Map(); // id → { id, from, to, timer }
  const matches = new Map(); // id → { id, a, b, table, slapper, turn, power, waiting, timer }
  const owners = new Map();  // employee key → { token, until }: the browser that is that employee
  let nextId = 1;

  const sockets = key => [...io.of('/').sockets.values()].filter(s => who.get(s.id)?.key === key);
  const tell = (key, event, data) => sockets(key).forEach(s => s.emit(event, data));
  const fighting = key => [...matches.values()].some(m => m.a.key === key || m.b.key === key);
  const busy = key => fighting(key) || [...invites.values()].some(i => i.from.key === key || i.to.key === key);
  const list = () => [...new Map([...who.values()].map(w => [w.key, { ...w, busy: fighting(w.key) }])).values()];
  const online = () => io.emit('slap:online', list());

  // When nobody is that employee any more, their browser keeps them reserved for a while.
  function free(me) { if (me && !sockets(me.key).length && owners.has(me.key)) owners.get(me.key).until = Date.now() + RECLAIM_MS; }
  function closeInvite(inv, why) {
    clearTimeout(inv.timer); invites.delete(inv.id);
    tell(inv.to.key, 'slap:invite-closed', { id: inv.id });
    if (why) tell(inv.from.key, 'slap:declined', { id: inv.id, name: inv.to.name, why });
  }
  function start(inv) {
    const used = new Set([...matches.values()].map(m => m.table));
    const table = [...Array(TABLES).keys()].find(t => !used.has(t)) ?? Math.floor(Math.random() * TABLES);
    const first = Math.random() < .5 ? 0 : 1;
    const m = { id: inv.id, a: inv.from, b: inv.to, table, slapper: first, turn: 0, power: [0, 0], waiting: false, timer: null };
    matches.set(m.id, m);
    io.emit('slap:start', { id: m.id, a: m.a, b: m.b, table, first });
    m.timer = setTimeout(() => turn(m), ms(SLAP_TIME.gather));
    online();
  }
  function turn(m) {
    m.waiting = true;
    io.emit('slap:turn', { id: m.id, slapper: m.slapper });
    m.timer = setTimeout(() => hit(m, SLAP_LATE), ms(SLAP_TIME.think));
  }
  function hit(m, power) {
    clearTimeout(m.timer); m.waiting = false;
    const ko = Math.random() < koChance(power);
    m.power[m.slapper] += power; m.turn++;
    io.emit('slap:hit', { id: m.id, power, ko });
    m.timer = setTimeout(() => {
      if (ko) return end(m, m.slapper, 'ko');
      if (m.turn >= SLAP_ROUNDS * 2) { const [a, b] = m.power; return end(m, a > b ? 0 : b > a ? 1 : null, a === b ? 'draw' : 'points'); }
      m.slapper = 1 - m.slapper; turn(m);
    }, ms(SLAP_TIME.after));
  }
  function end(m, winner, how) {
    matches.delete(m.id);
    io.emit('slap:end', { id: m.id, winner, how });
    online();
  }

  io.on('connection', socket => {
    socket.emit('slap:online', list());
    let lastChallenge = 0;
    socket.on('slap:iam', (me, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const was = who.get(socket.id), key = text(me?.key, MAX_KEY), name = text(me?.name, MAX_NAME), token = text(me?.token, 64);
      if (was && was.key !== key && busy(was.key)) return reply({ ok: false, error: 'Finish your challenge or fight first' });
      if (!key || !name) { who.delete(socket.id); free(was); online(); return reply({ ok: true }); }
      const owner = owners.get(key);
      if (owner && owner.token !== token && (sockets(key).length || Date.now() < owner.until)) return reply({ ok: false, error: `Someone else is online as ${name}` });
      const mine = owner?.token === token ? owner.token : randomUUID();
      owners.set(key, { token: mine, until: 0 });
      who.set(socket.id, { key, name }); if (was?.key !== key) free(was);
      online(); reply({ ok: true, token: mine });
    });
    socket.on('slap:challenge', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const me = who.get(socket.id), to = text(msg?.to, MAX_KEY), them = [...who.values()].find(w => w.key === to);
      if (!me) return reply({ ok: false, error: 'Pick who you are first' });
      if (!them) return reply({ ok: false, error: 'They are not online any more' });
      if (them.key === me.key) return reply({ ok: false, error: "You can't challenge yourself" });
      if (busy(me.key)) return reply({ ok: false, error: 'You already have a challenge or a fight going' });
      if (busy(them.key)) return reply({ ok: false, error: `${them.name} is busy, try again in a bit` });
      if (Date.now() - lastChallenge < SPACING_MS) return reply({ ok: false, error: 'Slow down a little' });
      if (invites.size >= MAX_INVITES) return reply({ ok: false, error: 'Too many open challenges, try again in a bit' });
      if (matches.size >= TABLES) return reply({ ok: false, error: 'All the tables are taken, try again in a bit' });
      lastChallenge = Date.now();
      const inv = { id: nextId++, from: me, to: them, timer: null };
      inv.timer = setTimeout(() => closeInvite(inv, 'did not answer'), INVITE_MS);
      invites.set(inv.id, inv);
      tell(them.key, 'slap:invite', { id: inv.id, from: me });
      reply({ ok: true });
    });
    socket.on('slap:answer', msg => {
      const inv = invites.get(Number(msg?.id)), me = who.get(socket.id);
      if (!inv || me?.key !== inv.to.key) return;
      if (msg.accept !== true) return closeInvite(inv, 'said no');
      if (matches.size >= TABLES) return closeInvite(inv, 'could not find a free table');
      closeInvite(inv, null);
      start(inv);
    });
    socket.on('slap:power', msg => {
      const m = matches.get(Number(msg?.id)), me = who.get(socket.id), power = Number(msg?.power);
      if (!m?.waiting || me?.key !== (m.slapper === 0 ? m.a : m.b).key || !Number.isFinite(power)) return;
      hit(m, Math.max(0, Math.min(1, power)));
    });
    socket.on('disconnect', () => {
      const me = who.get(socket.id); who.delete(socket.id); free(me);
      // their challenges lapse when this was their last tab; a fight goes on (their slaps come late and weak)
      if (me && !sockets(me.key).length) for (const inv of [...invites.values()]) {
        if (inv.to.key === me.key) closeInvite(inv, 'went offline');
        else if (inv.from.key === me.key) closeInvite(inv, null);
      }
      online();
    });
  });
}

export { attachSlap };
