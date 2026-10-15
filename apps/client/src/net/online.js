import { io } from 'socket.io-client';
import { getAccount, logout, mintTicket, showLogin } from './login.js';
import { initVoice } from './voice.js';
import { setCreatorHandler } from '../ui/creator.js';
import { getCharacter, showCreator } from './creator.js';
import { initChat } from './chat.js';
import { initObjectControls, tickObjectControls } from './objects.js';
import { careNote, initCare, selectCareItem } from './care.js';
import { initMedbox, medkitNote } from '../ui/medbox.js';
import { predictCarried } from '../render/objects.js';
import { addObjectView, updateCarriedObjects } from '../render/objects.js';
import { setView, viewId } from '../camera/controller.js';
import { player } from '../player/player.js';
import { ctl } from '../player/control.js';
import {
  CLOCK, HOTBAR_SIZE, INVENTORY_COLUMNS, INVENTORY_ROWS, Mirror, PROTOCOL_VERSION, Reconciler, addLog, angDiff, applyObjectPose, applyObjectPoses, decode, encode, footprintForItem, interactables, layoutCheck, live, materializeObject, people, simEvents, sim, hasSlot,
} from '@office/shared';

// Online mode: the page is a viewer of the server's office. It does not run the simulation; it applies what the
// server sends (through the shared Mirror), smooths people between snapshots, and keeps the clock running between them.
// See docs/PHASE-2-BREAKDOWN.md, step 6. Since phase 3 it needs an account: log in, ask for a one-time ticket,
// and say it in the first message.

const DELAY_MS = 150; // people are drawn this far in the past, so there are always two snapshots to blend between
const SNAP_DISTANCE = 2.5; // a jump bigger than this (metres) is a teleport, not a walk
const MAX_BUFFER = 8;
let inventoryCollapsed = true;
let inventoryDragId = null;
/** The hotbar slot picked (press its number or click it): a medical item picked there is what hold-E gives. */
let selectedSlot = null;
let inventoryDragHandled = false;

/** Where /api and /socket.io live. `?online=http://localhost:3000` points at a server on this computer; otherwise the page's own origin. */
export function serverBase() {
  const v = new URLSearchParams(location.search).get('online');
  if (!v || !/^https?:\/\//.test(v)) return '';
  // only this page's own origin or a server on this computer: a link must not be able to point the login screen (and the
  // password typed into it) at somebody else's server
  try {
    const u = new URL(v);
    if (u.origin !== location.origin && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return '';
    return u.origin;
  } catch { return ''; }
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
  for (const el of document.querySelectorAll('#staff, #play, [data-speed], [data-mode], [data-simtime]')) {
    el.disabled = true;
    el.title = 'The server controls this (admins can change it)';
  }
}

export function startOnline() {
  const base = serverBase();
  // the voice follows where you stand and which way you look (the camera's yaw, else the way you face)
  const voice = initVoice({ base, listener: () => { const p = player.person; return p ? { x: p.pos.x, z: p.pos.z, yaw: Number.isFinite(ctl.yaw) ? ctl.yaw : p.face } : null; } });
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
  const net = { mirror, voice, rttMs: null, connected: false, layoutOk: true, fatal: null, snapshots: 0, trace: new Map() };
  net.account = null;
  net.you = null; // the id of the person this account drives (from the welcome)
  net.joined = false; // the server has accepted our hello: inputs may be sent
  net.autoView = false; // the first welcome of a login puts you in third person, once
  net.pred = { acks: 0, pulls: 0, snaps: 0, maxError: 0, lastError: 0, owed: { x: 0, z: 0 } }; // what prediction has been doing (for checks); `owed`: a pull not yet glided in
  lockServerControls();
  setStatus('wait', 'Connecting to the server…');

  const socket = io(base || undefined, { transports: ['websocket'], reconnectionDelay: 500, reconnectionDelayMax: 4000, autoConnect: false });
  const send = msg => socket.emit('m', encode(msg));
  const chat = initChat({ send: text => send({ type: 'say', text }), sendEmote: kind => send({ type: 'emote', kind }), personById: id => mirror.people.get(id) });

  // ---- driving: what the player wants goes to the server (at most about 20 inputs a second), the result comes back in snapshots
  let seq = 1, lastSentAt = 0, lastSent = null, lastPosture = null;
  const reconciler = new Reconciler();
  // ?nopredict switches prediction off (the person then moves only when the server says so): for comparing
  const predicting = !new URLSearchParams(location.search).has('nopredict');
  const INPUT_MS = 50, URGENT_MS = 33;
  function sendInput(mx, mz, heading, run, posture = {}) {
    if (!net.joined || !Number.isFinite(mx + mz + heading)) return false;
    const moving = Math.hypot(mx, mz) > .08;
    const was = lastSent !== null && lastSent.moving;
    const turned = lastSent === null ? true : Math.abs(angDiff(lastSent.heading, heading)) > .03;
    // Posture is state, not just an action. In particular, send the all-false state when a key is
    // released so the server can clear its held edges while the person is standing still.
    const nextPosture = {
      crouch: posture.crouch === true,
      prone: posture.prone === true,
      jump: posture.jump === true,
      struggle: posture.struggle === true,
      crouchWheel: Number.isFinite(posture.crouchWheel) ? Math.trunc(posture.crouchWheel) : 0,
    };
    const postureChanged = lastPosture === null || Object.keys(nextPosture).some(k => nextPosture[k] !== lastPosture[k]);
    if (!moving && !was && !turned && !postureChanged) return false; // no movement, turn, or posture transition to report
    const now = performance.now(), since = now - lastSentAt;
    // while moving, repeat every 50 ms so the server keeps believing it (it stops you after a quarter second of silence);
    // starting or stopping is sent at once
    if (!(since >= INPUT_MS || (moving !== was && since >= URGENT_MS))) return false;
    lastSentAt = now; lastSent = { moving, heading }; lastPosture = nextPosture;
    const n = seq++;
    send({ type: 'input', seq: n, mx, mz, heading, run: !!run, ...nextPosture });
    const me = player.person;
    if (me) reconciler.record(n, me.pos.x + net.pred.owed.x, me.pos.z + net.pred.owed.z); // where the prediction is when this input goes out (with any correction still being glided in)
    return true;
  }
  const sendAct = kind => { if (net.joined) send({ type: 'act', kind }); };
  const sendAttack = (phase, kind = 'punch', side) => {
    if (!net.joined) return false;
    send({ type: 'attack', phase, kind, ...(side ? { side } : {}) });
    return true;
  };
  const sendCharacter = (action, target, az, lift) => {
    if (!net.joined) return false;
    if (action === 'grab') {
      if (!Number.isInteger(target)) return false;
      send({ type: 'grab-character', target, az: Number.isFinite(az) ? az : 0, lift: Number.isFinite(lift) ? lift : 1 });
    } else send({ type: action === 'release' ? 'release-character' : 'throw-character' });
    return true;
  };
  initObjectControls({ send });
  const revisionNow = () => inventoryOwner()?.mechanics?.inventoryRevision ?? 0;
  initCare({ send, revision: revisionNow, say: text => chat.system(text, 'notice') });
  initMedbox({ send, revision: revisionNow });
  // ?netdebug: a readout of how prediction is doing, top left, for chasing a jump you can see: how often the server corrected you, by how
  // much, how far your person is drawn from where the server has you, and the biggest step your person made in one frame lately
  const netDebug = new URLSearchParams(location.search).has('netdebug');
  let dbgEl = null, dbgAt = 0, dbgLast = null, dbgBig = { d: 0, t: 0 }, dbgFps = 60;
  function showNetDebug(dt) {
    const me = player.person, now = performance.now();
    dbgFps += (1 / Math.max(dt, 1e-3) - dbgFps) * .05;
    if (me) {
      if (dbgLast) { const d = Math.hypot(me.pos.x - dbgLast.x, me.pos.z - dbgLast.z); if (d > dbgBig.d || now - dbgBig.t > 5000) dbgBig = { d, t: now }; }
      dbgLast = { x: me.pos.x, z: me.pos.z };
    }
    if (now - dbgAt < 250) return;
    dbgAt = now;
    if (!dbgEl) { dbgEl = document.createElement('pre'); dbgEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;margin:0;padding:6px 8px;font:11px/1.4 monospace;background:rgba(0,0,0,.65);color:#fff;border-radius:6px;pointer-events:none'; document.body.appendChild(dbgEl); }
    const n = me && me._buf && me._buf[me._buf.length - 1], pr = net.pred;
    dbgEl.textContent = `fps ${dbgFps.toFixed(0)}  rtt ${net.rttMs ?? '-'} ms
pulls ${pr.pulls}  snaps ${pr.snaps}  last ${pr.lastError.toFixed(2)} m  max ${pr.maxError.toFixed(2)} m
drawn vs server ${n ? Math.hypot(me.pos.x - n.x, me.pos.z - n.z).toFixed(2) : '-'} m
biggest frame step (5 s) ${dbgBig.d.toFixed(2)} m`;
  }
  // what you alone carry is drawn with you (render/objects.js): where you are drawn, and where the server last had you
  predictCarried(o => {
    const me = player.person;
    if (!me || o.carriedBy !== net.you || o.helpers?.length || !player.online.predicting) return null;
    const n = me._buf && me._buf[me._buf.length - 1];
    return n ? { x: me.pos.x, z: me.pos.z, face: me.face, serverX: n.x, serverZ: n.z, serverFace: n.face } : null;
  });
  player.online = { input: sendInput, act: sendAct, attack: sendAttack, character: sendCharacter, predicting, lastMovedAt: -1e9, movedNow() { this.lastMovedAt = performance.now(); } };

  /** Forget who you were: after a logout, an ended session or a fatal error nothing of the old person may stay on screen or be steered. */
  function resetLocal() {
    voice.hide?.();
    net.you = null; net.joined = false; net.autoView = false;
    live.mode = 'sim'; // (the copy of the server's clock mode: the next welcome says)
    player.person = null; player.sitting = null; player.moving = false;
    if (player.controlling) setView('free');
    chat.setActive(false);
    showWho();
  }

  /** Say who you are and whether you have a desk: in the account box, and a note for guests. */
  function inventoryOwner() {
    return net.you !== null ? mirror.people.get(net.you) : null;
  }

  function sendInventory(action, values = {}) {
    const me = inventoryOwner(), inventory = me?.inventory;
    if (!net.joined || !inventory) return false;
    send({ type: 'inventory', action, revision: me.mechanics.inventoryRevision, ...values });
    return true;
  }

  function renderInventory() {
    const panel = document.getElementById('inventoryPanel');
    const grid = document.getElementById('inventoryGrid');
    const hotbar = document.getElementById('inventoryHotbar');
    const me = inventoryOwner(), inventory = me?.inventory;
    if (!panel || !grid || !hotbar) return;
    const details = document.getElementById('inventoryDetails');
    const toggle = document.getElementById('inventoryToggle');
    if (details) { details.hidden = inventoryCollapsed; details.setAttribute('aria-hidden', String(inventoryCollapsed)); }
    if (toggle) { toggle.setAttribute('aria-expanded', String(!inventoryCollapsed)); toggle.textContent = inventoryCollapsed ? 'Show' : 'Hide'; }
    panel.hidden = !inventory;
    if (!inventory) { selectedSlot = null; selectCareItem(null); grid.replaceChildren(); hotbar.replaceChildren(); return; }
    const itemName = item => item.type.replace(/[-_]/g, ' ');
    const cellPoint = event => {
      const rect = grid.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: Math.max(0, Math.min(INVENTORY_COLUMNS - 1, Math.floor((event.clientX - rect.left) / (rect.width / INVENTORY_COLUMNS)))),
        y: Math.max(0, Math.min(INVENTORY_ROWS - 1, Math.floor((event.clientY - rect.top) / (rect.height / INVENTORY_ROWS))))
      };
    };
    // The grid persists across snapshots. Bind its listeners once, otherwise every
    // snapshot would submit the same drag with an increasingly stale revision.
    if (!grid.dataset.bound) {
      grid.dataset.bound = '1';
      grid.addEventListener('dragover', event => {
        if (!event.dataTransfer?.types.includes('text/inventory-item')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      grid.addEventListener('drop', event => {
        event.preventDefault();
        const id = event.dataTransfer?.getData('text/inventory-item');
        const point = cellPoint(event);
        if (id && point) sendInventory('move', { itemId: id, ...point });
      });
    }
    const draw = () => {
      const owner = inventoryOwner(), state = owner?.inventory;
      if (!state) { panel.hidden = true; return; }
      panel.hidden = false;
      const revision = document.getElementById('inventoryRevision');
      if (revision) revision.textContent = `rev ${owner.mechanics.inventoryRevision}`;
      grid.replaceChildren(); hotbar.replaceChildren();
      for (let i = 0; i < INVENTORY_COLUMNS * INVENTORY_ROWS; i++) {
        const cell = document.createElement('div'); cell.className = 'inventory-cell'; cell.setAttribute('role', 'gridcell'); cell.dataset.cell = String(i);
        grid.append(cell);
      }
      for (const item of state.items) {
        const [width, height] = footprintForItem(item.type, item.rotation);
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'inventory-item'; el.draggable = true; el.dataset.itemId = item.id;
        el.textContent = itemName(item); el.title = `${itemName(item)} · drag to hotbar or outside to place`;
        el.style.gridColumn = `${item.x + 1} / span ${width}`; el.style.gridRow = `${item.y + 1} / span ${height}`;
        el.addEventListener('dragstart', event => {
          inventoryDragId = item.id; inventoryDragHandled = false;
          event.dataTransfer?.setData('text/inventory-item', item.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dblclick', () => sendInventory('rotate', { itemId: item.id }));
        el.addEventListener('dragend', event => {
          const r = panel.getBoundingClientRect();
          const outside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom ? false : event.clientX !== 0 || event.clientY !== 0;
          if (inventoryDragId === item.id && outside && !inventoryDragHandled) sendInventory('drop', { itemId: item.id });
          inventoryDragId = null; inventoryDragHandled = false;
        });
        grid.append(el);
      }
      state.hotbar.forEach((itemId, slot) => {
        const slotEl = document.createElement('div'); slotEl.className = 'hotbar-slot'; slotEl.dataset.slot = String(slot); slotEl.setAttribute('role', 'button'); slotEl.tabIndex = 0;
        const item = state.items.find(candidate => candidate.id === itemId);
        slotEl.textContent = item ? `${slot + 1} · ${itemName(item)}` : String(slot + 1); slotEl.setAttribute('aria-label', item ? `Hotbar ${slot + 1}: ${itemName(item)}` : `Empty hotbar slot ${slot + 1}`);
        slotEl.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; });
        slotEl.addEventListener('drop', event => { event.preventDefault(); const id = event.dataTransfer?.getData('text/inventory-item'); if (id) { inventoryDragHandled = true; sendInventory('hotbar', { itemId: id, slot }); } });
        if (slot === selectedSlot && item) slotEl.classList.add('selected');
        slotEl.addEventListener('click', () => {
          if (!itemId) return;
          // Picking a slot is not a mutation: nothing is sent (a hotbar command without an itemId would clear the slot). A medical item picked
          // here is what holding E gives (see care.js); picking the same slot again puts it away.
          selectedSlot = selectedSlot === slot ? null : slot;
          draw();
        });
        hotbar.append(slotEl);
      });
      // what is picked now: gone from the hotbar (used up, moved) means nothing is picked
      const pickedId = selectedSlot === null ? null : state.hotbar[selectedSlot];
      const picked = pickedId ? state.items.find(candidate => candidate.id === pickedId) : null;
      if (!picked) selectedSlot = null;
      selectCareItem(picked ?? null);
    };
    draw();
  }

  document.getElementById('inventoryToggle')?.addEventListener('click', () => {
    inventoryCollapsed = !inventoryCollapsed;
    renderInventory();
  });
  addEventListener('keydown', event => {
    const target = event.target;
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return;
    if (event.key.toLowerCase() === 'i') {
      inventoryCollapsed = !inventoryCollapsed;
      renderInventory();
      event.preventDefault();
      return;
    }
    const slot = Number(event.key) - 1;
    if (slot < 0 || slot >= HOTBAR_SIZE || !net.joined) return;
    const el = document.querySelector(`#inventoryHotbar [data-slot="${slot}"]`);
    if (el) { el.click(); event.preventDefault(); }
  });

  function showWho() {
    renderInventory();
    const me = net.you !== null ? mirror.people.get(net.you) : null;
    const box = document.getElementById('accountBox');
    if (box) {
      let info = document.getElementById('deskInfo');
      if (!info) { info = document.createElement('span'); info.id = 'deskInfo'; box.insertBefore(info, box.children[1] ?? null); }
      info.textContent = !me ? '' : me.slot ? me.slot.place : 'Guest · no desk yet';
    }
    let note = document.getElementById('guestNote');
    const guest = !!me && !me.slot;
    if (guest && !note) { note = document.createElement('div'); note.id = 'guestNote'; note.setAttribute('role', 'status'); document.body.append(note); }
    if (note) {
      note.hidden = !guest;
      note.textContent = 'You are a guest. You can walk around and sit in shared seats; an admin will give you a desk.';
    }
  }

  // the HUD's character buttons edit your look on the server, not in this browser
  setCreatorHandler(async () => { const mine = await getCharacter(base); if (mine) await showCreator(base, mine.spec ?? mine.starting); });

  // Make sure someone is logged in (showing the login screen if not), then open the connection.
  let loggingIn = null; // one login at a time, however many things ask for it
  function logIn(note = '') {
    loggingIn ??= (async () => {
      try {
        let account = note ? null : await getAccount(base);
        if (account?.mustChangePassword) account = null; // still on the first password an admin set: the screen asks for a new one
        if (!account) { setStatus('wait', 'Please log in'); account = await showLogin(base, note); }
        net.account = account;
        // a person with a desk and no look yet makes their character before anything else (the first login after a desk is given)
        if ((account.slotSpot || account.employeeId) && !account.hasLook) {
          const mine = await getCharacter(base);
          // (if saving keeps failing, the page is not a trap: log out, and the login screen comes back)
          if (await showCreator(base, mine?.starting, { required: true, onLogout: async () => { await logout(base); location.reload(); } })) account.hasLook = true;
        }
        showAccountBox(account);
        setStatus('wait', 'Connecting to the server…');
        socket.connect();
      } finally { loggingIn = null; }
    })();
    return loggingIn;
  }

  function showAccountBox(account) {
    let box = document.getElementById('accountBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'accountBox';
      const look = document.createElement('button');
      look.id = 'characterBtn'; look.textContent = 'Character';
      look.addEventListener('click', async () => {
        const mine = await getCharacter(base);
        if (mine) await showCreator(base, mine.spec ?? mine.starting);
      });
      box.append(document.createElement('span'), look, document.createElement('button'));
      box.lastChild.textContent = 'Log out';
      box.lastChild.addEventListener('click', async () => {
        net.fatal = null;
        socket.disconnect();
        await logout(base);
        resetLocal();
        mirror.clear();
        await logIn('You are logged out.');
      });
      document.body.append(box);
    }
    box.firstChild.textContent = account.username;
  }

  socket.on('connect', async () => {
    net.connected = true;
    // a fresh ticket for every connection, including each automatic reconnect
    let got = await mintTicket(base);
    while (got.retryable && socket.connected && !net.fatal) { await new Promise(r => setTimeout(r, 2000)); got = await mintTicket(base); } // busy or no network: wait, do not log out
    if (!socket.connected) return;
    if (got.loggedOut) { socket.disconnect(); resetLocal(); mirror.clear(); await logIn('Your session has ended. Please log in again.'); return; }
    send({ type: 'hello', version: PROTOCOL_VERSION, ticket: got.ticket });
  });
  socket.on('disconnect', () => { void voice.disconnect(); net.connected = false; net.joined = false; if (!net.fatal) setStatus('wait', 'Connection lost, reconnecting…'); });
  socket.on('connect_error', () => { if (!net.fatal) setStatus('wait', 'Cannot reach the server, retrying…'); });
  void logIn();

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
        for (const definition of msg.objectDefinitions ?? []) {
          const o = materializeObject(definition);
          if (o) addObjectView(o);
        }
        applyObjectPoses(msg.objects); // chairs and things that are not where they started
        net.you = msg.you; net.joined = true; seq = 1; lastSent = null; lastPosture = null; lastSentAt = 0; reconciler.reset(); net.pred.owed = { x: 0, z: 0 }; // (a new connection numbers its messages from the start)
        voice.show?.();
        player.person = mirror.people.get(msg.you) ?? null;
        syncClock();
        reassignOccupants();
        showWho();
        renderInventory();
        chat.setActive(true);
        setStatus('ok', `Online · ${people.length} people`);
        if (!net.autoView && player.person && viewId() !== 'fp' && viewId() !== 'third') { net.autoView = true; setView('third'); } // you arrive as your person
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
        renderInventory();
        break;
      case 'ack': {
        const me = player.person;
        if (!me || msg.tick === undefined) break;
        net.pred.acks++;
        const idle = performance.now() - player.online.lastMovedAt > 400; // standing still for a moment
        const c = reconciler.reconcile(msg, me.pos, idle);
        // (a pull is glided in over a few frames, not jumped: see frame. A snap is a real teleport, a desk taken or the world reset)
        if (c.kind === 'pull') { net.pred.owed.x += c.dx; net.pred.owed.z += c.dz; net.pred.pulls++; }
        else if (c.kind === 'snap') { me.pos.x = c.x; me.pos.z = c.z; net.pred.owed = { x: 0, z: 0 }; net.pred.snaps++; }
        if (c.kind !== 'none') { net.pred.lastError = c.error; net.pred.maxError = Math.max(net.pred.maxError, c.error); }
        break;
      }
      case 'person': mirror.applyJoin(msg.info, msg.snap); reassignOccupants(); renderInventory(); if (msg.info.id === net.you) { player.person = mirror.people.get(net.you) ?? null; showWho(); } break;
      case 'leave': mirror.applyLeave(msg.id); reassignOccupants(); break;
      case 'event': pushEvent(msg); break;
      case 'chat': chat.receive(msg); break;
      case 'object': {
        const o = msg.definition ? materializeObject(msg.definition) : null;
        if (o) addObjectView(o);
        applyObjectPose(msg.pose);
        break;
      }
      case 'emoted': { net.emotesSeen = (net.emotesSeen ?? 0) + 1; const who = mirror.people.get(msg.from); if (who) { const t = performance.now(); who.emote = { kind: msg.kind, t0: t, until: t + 2600 }; } break; }
      case 'pong': net.rttMs = Math.round(performance.now() - msg.ts); break;
      case 'kick':
        socket.disconnect();
        if (/logged out|session/.test(msg.reason)) { resetLocal(); mirror.clear(); void logIn('Your session has ended. Please log in again.'); break; } // log in and the connection comes back
        net.fatal = msg.reason;
        resetLocal();
        setStatus('bad', `Disconnected: ${msg.reason}`);
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
    live.mode = c.live ? 'live' : 'sim'; // the server's clock mode (this page never steps the simulation, it only shows it)
    const staffEl = document.getElementById('staff'), valEl = document.getElementById('staffVal');
    const n = people.filter(hasSlot).length;
    if (staffEl) staffEl.value = String(n);
    if (valEl) valEl.textContent = String(n);
    const play = document.getElementById('play');
    if (play) { play.classList.toggle('paused', c.paused); const label = c.paused ? 'Paused' : 'Running'; play.setAttribute('aria-label', label); play.title = label + ' (the server controls this)'; }
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mode === 'live') === !!c.live)));
    document.querySelectorAll('[data-simtime]').forEach(b => b.setAttribute('aria-pressed', 'false')); // (the server does not say which start it used)
    const simRow = document.getElementById('simRow'); if (simRow) simRow.hidden = !!c.live;
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(!c.live && Number(b.dataset.speed) === c.speed)));
    document.body.classList.toggle('clock-live', !!c.live);
  }

  /** Shared places (darts, golf, the keyboard) show who is using them: rebuild that from where everyone is. */
  function reassignOccupants() {
    for (const s of interactables.all()) s.occupant = null;
    for (const p of people) if (p.task && (p.task.kind === 'playerSit' || (p.task.spot.shared && (p.state === 'doing' || p.state === 'walking')))) p.task.spot.occupant = p; // (a human in a seat, at a desk too)
  }

  function pushEvent(e) {
    if (e.kind === 'notice') { chat.system(e.text, 'notice'); return; } // for this player alone: in the chat panel
    if (e.kind === 'medkit') { medkitNote(e.text); return; } // what the medkit they have open holds
    if (e.kind === 'care') { careNote(e.text); return; } // how the care they are giving is going
    if (e.kind === 'announce') chat.system(`Announcement: ${e.text}`, 'announce');
    // the log lines also reach the ledger the way local ones do
    addLog(e.kind === 'announce' ? `Announcement: ${e.text}` : e.text);
  }

  /** Walking legs: the stride follows the distance covered (as in the simulation); a human is `moving` if they cover ground. */
  function trackMotion(p, px, pz, dt) {
    const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
    if (p.state === 'walking' || p.state === 'controlled') p.walkPhase += d * 4.6;
    if (p.state === 'controlled') {
      p._speed = (p._speed ?? 0) + ((dt > 0 ? d / dt : 0) - (p._speed ?? 0)) * (1 - Math.exp(-dt * 12));
      p.moving = p._speed > .25;
    }
  }

  /** Called every frame instead of the simulation step. */
  function frame(dt, now) {
    if (!sim.paused) sim.t += dt * sim.speed * CLOCK; // keep the clock moving between snapshots; the next one corrects it
    const renderT = now - DELAY_MS;
    // your person is looked up again each frame: a changed look replaces the object
    if (net.you !== null) player.person = mirror.people.get(net.you) ?? null;
    if (net.you !== null && !player.person) net.autoView = false; // (arrive in third person again when the person is back)
    if (player.controlling && !player.person) setView('free');
    for (const p of people) {
      const buf = p._buf;
      if (!buf || buf.length === 0) continue; // not someone the server told us about (for example your own local visitor)
      if (p.state !== 'away') p.animT += dt * Math.min(sim.speed, 2.5);
      const px = p.pos.x, pz = p.pos.z;
      if (p.id === net.you) {
        // you: the newest position the server has told us, lightly smoothed (not 150 ms in the past like everyone else), so you
        // react after about one round trip. (Prediction, which removes even that, is phase 4.)
        const n = buf[buf.length - 1];
        while (buf.length > 1) buf.shift();
        const steered = player.controlling && player.online.predicting && now - player.online.lastMovedAt < 400; // moved by prediction a moment ago: the acks keep it right
        const owed = net.pred.owed;
        if (owed.x || owed.z) { // a pull from an ack, glided in over about a tenth of a second
          const k = 1 - Math.exp(-dt * 12), gx = owed.x * k, gz = owed.z * k;
          p.pos.x += gx; p.pos.z += gz; owed.x -= gx; owed.z -= gz;
          if (Math.hypot(owed.x, owed.z) < 1e-3) { p.pos.x += owed.x; p.pos.z += owed.z; owed.x = owed.z = 0; }
        }
        if (steered) { /* position comes from the keys; net.pred pulls it back if the server disagrees */ } else if (Math.hypot(n.x - p.pos.x, n.z - p.pos.z) > SNAP_DISTANCE) { p.pos.x = n.x; p.pos.z = n.z; } else {
          // standing still: settle onto where the server has you. Gently while you steer (the few centimetres the server's ticks put you
          // off where you stopped, settled over half a second, not jumped); quickly while you only watch
          const k = 1 - Math.exp(-dt * (player.controlling ? 5 : 30));
          p.pos.x += (n.x - p.pos.x) * k; p.pos.z += (n.z - p.pos.z) * k;
        }
        if (!player.controlling) { p.face += angDiff(p.face, n.face) * (1 - Math.exp(-dt * 20)); p.faceGoal = p.face; } // (while steering, the camera owns the facing)
        trackMotion(p, px, pz, dt);
        continue;
      }
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
      trackMotion(p, px, pz, dt);
    }
    updateCarriedObjects(dt); tickObjectControls(dt); // (after everybody has been placed for this frame)
    if (netDebug) showNetDebug(dt);
    const el = document.getElementById('netStatus');
    if (net.connected && !net.fatal && el && el.className === 'ok') {
      const t = `Online · ${people.length} people${net.rttMs !== null ? ` · ${net.rttMs} ms` : ''}`;
      if (el.textContent !== t) el.textContent = t;
    } else if (net.connected && !net.fatal && el && el.className === 'wait' && mirror.people.size) setStatus('ok', 'Online');
  }

  return { net, frame, socket };
}
