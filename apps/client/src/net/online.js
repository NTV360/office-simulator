import { io } from 'socket.io-client';
import {
  CLOCK, Mirror, PROTOCOL_VERSION, addLog, angDiff, decode, encode, interactables, layoutCheck, people, simEvents, sim, hasSlot,
} from '@office/shared';

// Online mode: the page is a viewer of the server's office. It does not run the simulation; it applies what the
// server sends (through the shared Mirror), smooths people between snapshots, and keeps the clock running between them.
// See docs/PHASE-2-BREAKDOWN.md, step 6.

const DELAY_MS = 150; // people are drawn this far in the past, so there are always two snapshots to blend between
const SNAP_DISTANCE = 2.5; // a jump bigger than this (metres) is a teleport, not a walk
const MAX_BUFFER = 8;

/** Where /api and /socket.io live. `?online=http://host:3000` points at another server; otherwise the page's own origin. */
export function serverBase() {
  const v = new URLSearchParams(location.search).get('online');
  return v && /^https?:\/\//.test(v) ? v.replace(/\/$/, '') : '';
}

function statusBox() {
  let el = document.getElementById('netStatus');
  if (!el) { el = document.createElement('div'); el.id = 'netStatus'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  return el;
}
function setStatus(kind, text) {
  const el = statusBox();
  el.className = kind;
  el.textContent = text;
}

/** Switch the controls that belong to the server (staff count, clock) off, and say why. */
function lockServerControls() {
  document.body.classList.add('online');
  for (const el of document.querySelectorAll('#staff, #play, [data-speed]')) {
    el.disabled = true;
    el.title = 'The server controls this (admins can change it)';
  }
}

export function startOnline() {
  const base = serverBase();
  const mirror = new Mirror(interactables.all(), {
    added(p) {
      people.push(p);
      if (p.slot) p.slot.owner = p;
      simEvents.emit('personAdded', p);
    },
    removed(p) {
      const i = people.indexOf(p);
      if (i >= 0) people.splice(i, 1);
      if (p.slot && p.slot.owner === p) p.slot.owner = null;
      simEvents.emit('personRemoved', p);
    },
    position(p, x, z, face, walkPhase, isNew) {
      const now = performance.now();
      if (isNew || !p._buf) { p.pos.x = x; p.pos.z = z; p.face = p.faceGoal = face; p._buf = [{ t: now, x, z, face }]; return; }
      p._buf.push({ t: now, x, z, face });
      if (p._buf.length > MAX_BUFFER) p._buf.shift();
    },
  });

  // ?trace keeps what the server said at its last few keyframes, for scripted checks (see tests/browser/verify.mjs)
  const tracing = new URLSearchParams(location.search).has('trace');
  const net = { mirror, rttMs: null, connected: false, layoutOk: true, fatal: null, snapshots: 0, trace: new Map() };
  lockServerControls();
  setStatus('wait', 'Connecting to the server…');

  const socket = io(base || undefined, { transports: ['websocket'], reconnectionDelay: 500, reconnectionDelayMax: 4000 });
  const send = msg => socket.emit('m', encode(msg));

  socket.on('connect', () => { net.connected = true; send({ type: 'hello', version: PROTOCOL_VERSION }); });
  socket.on('disconnect', () => { net.connected = false; if (!net.fatal) setStatus('wait', 'Connection lost, reconnecting…'); });
  socket.on('connect_error', () => { if (!net.fatal) setStatus('wait', 'Cannot reach the server, retrying…'); });

  socket.on('m', data => {
    let msg;
    try { msg = decode(new Uint8Array(data)); } catch (e) { console.error('bad message from the server:', e); return; }
    switch (msg.type) {
      case 'welcome': {
        const mine = layoutCheck();
        if (msg.layout.spots !== mine.spots || msg.layout.hash !== mine.hash) {
          net.layoutOk = false; net.fatal = 'layout';
          setStatus('bad', 'This page and the server have different offices. Rebuild and reload.');
          socket.disconnect();
          return;
        }
        mirror.applyWelcome(msg);
        syncClock();
        reassignOccupants();
        setStatus('ok', `Online · ${people.length} people`);
        break;
      }
      case 'snapshot':
        net.snapshots++;
        mirror.applySnapshot(msg);
        if (tracing && msg.full) {
          // the server's own positions (the newest buffered ones), not the smoothed ones that are drawn
          const raw = q => (q._buf && q._buf.length ? q._buf[q._buf.length - 1] : q.pos);
          net.trace.set(msg.tick, [...mirror.people.values()].map(q => [q.id, raw(q).x, raw(q).z, q.state, q.task ? q.task.kind : '']));
          if (net.trace.size > 12) net.trace.delete(net.trace.keys().next().value);
        }
        syncClock();
        reassignOccupants();
        break;
      case 'person': mirror.applyJoin(msg.info, msg.snap); reassignOccupants(); break;
      case 'leave': mirror.applyLeave(msg.id); reassignOccupants(); break;
      case 'event': pushEvent(msg); break;
      case 'pong': net.rttMs = Math.round(performance.now() - msg.ts); break;
      case 'kick':
        net.fatal = msg.reason;
        setStatus('bad', `Disconnected: ${msg.reason}`);
        socket.disconnect();
        break;
    }
  });

  const pinger = setInterval(() => {
    if (net.fatal) { clearInterval(pinger); return; }
    if (net.connected) send({ type: 'ping', ts: performance.now() });
  }, 3000);

  function syncClock() {
    const c = mirror.clock;
    sim.t = c.simTime; sim.day = c.day; sim.speed = c.speed; sim.paused = c.paused;
    const staffEl = document.getElementById('staff'), valEl = document.getElementById('staffVal');
    const n = people.filter(hasSlot).length;
    if (staffEl) staffEl.value = String(n);
    if (valEl) valEl.textContent = String(n);
    const play = document.getElementById('play');
    if (play) play.textContent = c.paused ? 'Paused' : 'Running';
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === c.speed)));
  }

  /** Shared places (darts, golf, the keyboard) show who is using them: rebuild that from where everyone is. */
  function reassignOccupants() {
    for (const s of interactables.all()) if (s.shared) s.occupant = null;
    for (const p of people) if (p.task && p.task.spot.shared && (p.state === 'doing' || p.state === 'walking')) p.task.spot.occupant = p;
  }

  function pushEvent(e) {
    // the log lines also reach the ledger the way local ones do
    addLog(e.kind === 'announce' ? `Announcement: ${e.text}` : e.text);
  }

  /** Called every frame instead of the simulation step. */
  function frame(dt, now) {
    if (!sim.paused) sim.t += dt * sim.speed * CLOCK; // keep the clock moving between snapshots; the next one corrects it
    const renderT = now - DELAY_MS;
    for (const p of people) {
      const buf = p._buf;
      if (!buf || buf.length === 0) continue; // not someone the server told us about (for example your own local visitor)
      if (p.state !== 'away') p.animT += dt * Math.min(sim.speed, 2.5);
      const px = p.pos.x, pz = p.pos.z;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].t <= renderT) { a = buf[i - 1]; b = buf[i]; break; }
      if (buf.length > 2) while (buf.length > 2 && buf[1].t <= renderT) buf.shift(); // keep the segment we are in
      let k = b.t === a.t ? 1 : (renderT - a.t) / (b.t - a.t);
      k = Math.max(0, Math.min(1, k));
      if (Math.hypot(b.x - a.x, b.z - a.z) > SNAP_DISTANCE) k = renderT >= b.t ? 1 : 0;
      p.pos.x = a.x + (b.x - a.x) * k;
      p.pos.z = a.z + (b.z - a.z) * k;
      p.face = a.face + angDiff(a.face, b.face) * k;
      p.faceGoal = p.face;
      if (p.state === 'walking') p.walkPhase += Math.hypot(p.pos.x - px, p.pos.z - pz) * 4.6; // the same stride as the simulation
    }
    const el = document.getElementById('netStatus');
    if (net.connected && !net.fatal && el && el.className === 'ok') {
      const t = `Online · ${people.length} people${net.rttMs !== null ? ` · ${net.rttMs} ms` : ''}`;
      if (el.textContent !== t) el.textContent = t;
    } else if (net.connected && !net.fatal && el && el.className === 'wait' && mirror.people.size) setStatus('ok', 'Online');
  }

  return { net, frame, socket };
}
