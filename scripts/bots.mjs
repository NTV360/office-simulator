// A load test: many bots play at once, so you can see what the server can carry.   npm run bots -- --bots=50 --seconds=60
//   --url        the server (default http://localhost:8080, the Docker stack)
//   --token      the admin password of that stack (default local-admin-token)
//   --bots       how many players (default 50)   --seconds   how long they play (default 60)   --soak   also report memory growth every minute
// Each bot is a real client at the protocol level (the same messages as the page): it logs in, joins, walks about, sits and stands, talks, waves,
// tries to pick things up (mostly refused: too far, which exercises the refusal path too), and measures what the server gives back.
// It reports against the budgets in docs/MULTIPLAYER-PLAN.md section 14 and exits with code 1 if one is missed. Only for your own PC.
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { decode, decodeClient, encode, NONE, objects as _objects } from '../packages/shared/dist/index.js';

void decodeClient; void _objects;
const arg = (name, dflt) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const URL_ = arg('url', 'http://localhost:8080').replace(/\/+$/, '');
const TOKEN = arg('token', process.env.BOTS_ADMIN_TOKEN || 'local-admin-token');
const N = Number(arg('bots', 50)), SECONDS = Number(arg('seconds', 60));
if (!Number.isInteger(N) || N < 1 || !(SECONDS > 0)) { console.error('--bots must be a whole number of at least 1 and --seconds more than 0'); process.exit(2); }
const SOAK = process.argv.includes('--soak');
const RUN = Date.now().toString(36).slice(-5);
const FIRST_PASS = 'first-pass-from-admin-1', PASS = 'bots-pass-1234';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const fmt = x => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');

async function http(method, path, body, headers = {}) {
  const r = await fetch(URL_ + path, { method, headers: { 'content-type': 'application/json', origin: URL_, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), cookie: (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ') };
}
const admin = (method, path, body) => http(method, '/api/admin' + path, body, { authorization: 'Bearer ' + TOKEN });

// ---- accounts: made by the admin API, each bot chooses its own password
console.log(`load test: ${N} bots for ${SECONDS} s against ${URL_}  (run ${RUN})`);
if ((await admin('GET', '/settings')).status !== 200) { console.error('the admin API refused: check --token'); process.exit(2); }
const names = Array.from({ length: N }, (_, i) => `bot${RUN}_${String(i).padStart(3, '0')}`);
const t0 = performance.now();
const firsts = [];
for (let i = 0; i < names.length; i += 40) {
  const r = await admin('POST', '/users/bulk', { usernames: names.slice(i, i + 40) });
  if (r.status !== 201) { console.error('could not make accounts', r.status, JSON.stringify(r.body)); process.exit(2); }
  for (const row of r.body.results) if (!row.ok) { console.error('account refused:', row.username, row.message); process.exit(2); }
  r.body.results.forEach(row => firsts.push(row.password));
}

class Bot {
  constructor(i, name, first) {
    this.i = i; this.name = name; this.first = first;
    this.seq = 0; this.sent = new Map(); this.ackLat = []; this.rtt = []; this.bytes = 0; this.msgs = 0; this.snapshots = 0; this.errors = 0;
    this.heading = Math.random() * 6.28; this.kicked = null; this.joined = false; this.you = null; this.notices = 0; this.people = 0;
  }
  async login() {
    let r = await http('POST', '/api/auth/login', { username: this.name, password: this.first });
    if (r.status === 429) throw new Error('the server limits logins from one address (30 a minute). Start the stack with AUTH_LOGINS_PER_MINUTE=1000 for a load test, or run fewer bots.');
    if (r.status !== 200) throw new Error(`${this.name}: login ${r.status} ${JSON.stringify(r.body)}`);
    const c = await http('POST', '/api/auth/password', { current: this.first, next: PASS }, { cookie: r.cookie });
    if (c.status !== 200) throw new Error(`${this.name}: password ${c.status} ${JSON.stringify(c.body)}`);
    r = await http('POST', '/api/auth/login', { username: this.name, password: PASS });
    if (r.status !== 200) throw new Error(r.status === 429 ? 'the server limits logins from one address (start the stack with AUTH_LOGINS_PER_MINUTE=1000 for a load test)' : `${this.name}: second login ${r.status}`);
    this.cookie = r.cookie;
  }
  /** A one-time ticket (and a fresh login if the session is gone: the server ends other sessions when a password changes). */
  async newTicket() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = await http('POST', '/api/play/ticket', undefined, { cookie: this.cookie });
      if (t.status === 200) return t.body.ticket;
      if (t.status !== 401) throw new Error(`${this.name}: ticket ${t.status}`);
      this.cookie = (await http('POST', '/api/auth/login', { username: this.name, password: PASS })).cookie;
    }
    throw new Error(`${this.name}: no ticket after three tries`);
  }
  /** (the ticket is minted just before connecting: it lasts only 30 seconds) */
  async connect() {
    this.ticket = await this.newTicket();
    return new Promise((resolve, reject) => {
      this.socket = io(URL_, { transports: ['websocket'], reconnection: false, forceNew: true });
      const timer = setTimeout(() => reject(new Error(`${this.name}: no welcome`)), 30000);
      this.socket.on('connect', () => this.socket.emit('m', encode({ type: 'hello', version: this.version ?? 0, ticket: this.ticket })));
      this.socket.on('m', data => {
        const bytes = data instanceof ArrayBuffer ? data.byteLength : data.length;
        this.bytes += bytes; this.msgs++;
        let m; try { m = decode(new Uint8Array(data)); } catch { this.errors++; return; }
        if (m.type === 'welcome') { this.joined = true; this.you = m.you; this.people = m.people.length; clearTimeout(timer); resolve(); }
        else if (m.type === 'snapshot') this.snapshots++;
        else if (m.type === 'ack') { const t = this.sent.get(m.seq); if (t !== undefined) { this.ackLat.push(performance.now() - t); this.sent.delete(m.seq); } }
        else if (m.type === 'pong') this.rtt.push(performance.now() - m.ts);
        else if (m.type === 'kick') { this.kicked = m.reason; }
        else if (m.type === 'event' && m.kind === 'notice') this.notices++;
      });
      this.socket.on('disconnect', reason => { if (!this.closing) this.kicked = this.kicked ?? `disconnected: ${reason}`; });
      this.socket.on('connect_error', e => reject(e));
    });
  }
  send(m) { if (this.socket?.connected) this.socket.emit('m', encode(m)); }
  /** One step of playing (called about 20 times a second). */
  step(now) {
    if (!this.joined || this.kicked) return;
    if (Math.random() < .02) this.heading += (Math.random() - .5) * 2.4; // a wandering walk
    const moving = (this.i + Math.floor(now / 7000)) % 5 !== 0; // one bot in five stands still at a time
    const seq = ++this.seq;
    this.sent.set(seq, performance.now()); if (this.sent.size > 400) this.sent.delete(this.sent.keys().next().value);
    this.send({ type: 'input', seq, mx: moving ? Math.sin(this.heading) : 0, mz: moving ? Math.cos(this.heading) : 0, heading: this.heading, run: this.i % 3 === 0 });
    const r = Math.random();
    if (r < .0008) this.send({ type: 'say', text: `hello from ${this.name}` });
    else if (r < .0016) this.send({ type: 'emote', kind: 'wave' });
    else if (r < .0030) this.send({ type: 'act', kind: Math.random() < .5 ? 'sit' : 'stand' });
    else if (r < .0042) this.send({ type: 'grab', object: Math.floor(Math.random() * 160) });
    else if (r < .0046) this.send({ type: 'reset', scope: 'object', object: Math.floor(Math.random() * 160) });
  }
}

// the protocol version comes from the page's own build: ask the server which it speaks
const health = (await (await fetch(URL_ + '/api/health')).json());
const version = health.protocol;
const bots = names.map((n, i) => { const b = new Bot(i, n, firsts[i]); b.version = version; return b; });
console.log(`accounts made in ${((performance.now() - t0) / 1000).toFixed(1)} s; logging in (each hashes a password, so this takes a moment) ...`);
for (let i = 0; i < bots.length; i += 4) await Promise.all(bots.slice(i, i + 4).map(b => b.login()));
console.log('connecting ...');
const tc = performance.now();
for (let i = 0; i < bots.length; i += 10) await Promise.all(bots.slice(i, i + 10).map(b => b.connect()));
console.log(`all ${bots.length} are in (${((performance.now() - tc) / 1000).toFixed(1)} s); the first welcome listed ${bots[0].people} people`);

// ---- play
// (?fresh=1 empties the server's event-loop window, so the figure below is what this run did)
const before = (await (await fetch(URL_ + '/api/world?fresh=1')).json());
for (const b of bots) { b.bytes = 0; b.msgs = 0; b.snapshots = 0; b.errors = 0; }
const tStart = performance.now();
const stepTimer = setInterval(() => { const now = performance.now() - tStart; for (const b of bots) b.step(now); }, 50);
const pingTimer = setInterval(() => { for (const b of bots) b.send({ type: 'ping', ts: performance.now() }); }, 2000);
const soakRows = [];
const soakTimer = SOAK ? setInterval(async () => { try { const w = await (await fetch(URL_ + '/api/world')).json(); soakRows.push({ s: Math.round((performance.now() - tStart) / 1000), rssMb: w.process?.rssMb, heapMb: w.process?.heapMb, p99: w.tickMs?.p99Ms }); } catch { /* skip */ } }, 60000) : null;
const progress = setInterval(() => process.stdout.write('.'), 5000);
await sleep(SECONDS * 1000);
clearInterval(stepTimer); clearInterval(pingTimer); clearInterval(progress); if (soakTimer) clearInterval(soakTimer);
const seconds = (performance.now() - tStart) / 1000;
const after = (await (await fetch(URL_ + '/api/world')).json());

// ---- report
const lat = bots.flatMap(b => b.ackLat), rtt = bots.flatMap(b => b.rtt);
const kbs = bots.map(b => b.bytes / 1024 / seconds);
const kicked = bots.filter(b => b.kicked), errors = bots.reduce((a, b) => a + b.errors, 0);
const tick = after.tickMs ?? {};
const rows = [
  ['input to acknowledgement (ms), p50 / p95 / p99', `${fmt(pct(lat, 50))} / ${fmt(pct(lat, 95))} / ${fmt(pct(lat, 99))}`, 'p99 < 150', pct(lat, 99) < 150],
  ['ping round trip (ms), p50 / p99', `${fmt(pct(rtt, 50))} / ${fmt(pct(rtt, 99))}`, '', true],
  ['bandwidth received per bot (KB/s), mean / max', `${fmt(kbs.reduce((a, b) => a + b, 0) / kbs.length)} / ${fmt(Math.max(...kbs))}`, 'max < 40', Math.max(...kbs) < 40],
  ['server tick (ms), p50 / p99 / max (its own measure)', `${fmt(tick.p50Ms)} / ${fmt(tick.p99Ms)} / ${fmt(tick.maxMs)}`, 'p99 < 10', !(tick.p99Ms >= 10)],
  ['server event loop lag (ms), p99 / max', `${fmt(after.process?.eventLoopP99Ms)} / ${fmt(after.process?.eventLoopMaxMs)}`, 'p99 < 20', !(after.process?.eventLoopP99Ms >= 20)],
  ['server memory (MB), rss', fmt(after.process?.rssMb), '', true],
  ['snapshots received per bot per second', fmt(bots.reduce((a, b) => a + b.snapshots, 0) / bots.length / seconds), 'about 20', true],
  ['bots kicked or disconnected', String(kicked.length) + (kicked.length ? ' (' + [...new Set(kicked.map(b => b.kicked))].join('; ') + ')' : ''), '0', kicked.length === 0],
  ['messages that could not be decoded', String(errors), '0', errors === 0],
  ['late ticks during the run', String((after.tickMs?.lateTicks ?? 0) - (before.tickMs?.lateTicks ?? 0)), '', true],
];
console.log(`\n\n${bots.length} bots for ${seconds.toFixed(0)} s (${after.staff} staff, ${after.present} in) against the budgets in docs/MULTIPLAYER-PLAN.md section 14:\n`);
let failed = 0;
for (const [what, value, budget, ok] of rows) { console.log(`  ${ok ? 'ok  ' : 'MISS'}  ${what.padEnd(58)} ${value.padEnd(28)} ${budget}`); if (!ok) failed++; }
if (soakRows.length) { console.log('\n  soak (every minute):'); for (const r of soakRows) console.log(`    ${String(r.s).padStart(5)} s   rss ${fmt(r.rssMb)} MB   heap ${fmt(r.heapMb)} MB   tick p99 ${fmt(r.p99)} ms`); const first = soakRows[0]?.rssMb, last = soakRows.at(-1)?.rssMb; if (first && last) console.log(`    memory grew ${fmt(last - first)} MB over the run`); }

// ---- leave: the bots log out (their accounts stay; disable them on the admin page if you like)
for (const b of bots) { b.closing = true; b.socket?.disconnect(); }
await sleep(300);
console.log(failed ? `\n${failed} budget(s) missed` : '\nall budgets met');
process.exit(failed ? 1 : 0);
