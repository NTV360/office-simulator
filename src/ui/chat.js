import { io } from 'socket.io-client';
import { $ } from './dom.js';

/* ================= Office chat ================= */
// One room for everyone using the app, over Socket.IO (server/chat.js). Newcomers get the recent messages.
// People must pick a display name before they can chat (the message box appears after); this browser
// remembers it. "Chat" in the dock opens the panel
// and shows a badge for messages that arrived while it was closed.
const NAME_KEY = 'officeSim.chatName';
const POS_KEY = 'officeSim.chatPos';
const chat = { socket: null, open: false, unread: 0, name: '' };

const read = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } };
const write = v => { try { localStorage.setItem(NAME_KEY, v); } catch (_) {} };
const time = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function addMessage(m) {
  const li = document.createElement('li'); li.className = m.name === chat.name ? 'mine' : '';
  const head = document.createElement('div'); head.className = 'chat-meta';
  const who = document.createElement('b'); who.textContent = m.name;
  const at = document.createElement('time'); at.textContent = time(m.at); at.dateTime = m.at;
  head.append(who, at);
  const text = document.createElement('p'); text.textContent = m.text; // text only, never HTML
  li.append(head, text);
  const list = $('chatList'), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(li);
  while (list.children.length > 200) list.firstChild.remove();
  if (atBottom || m.name === chat.name) list.scrollTop = list.scrollHeight;
}
function setUnread(n) { chat.unread = n; $('chatBadge').hidden = !n; $('chatBadge').textContent = n > 9 ? '9+' : String(n); }
// Step 1 without a name: only the name box. Step 2: "Chatting as …" and the message box.
function showName() {
  const has = !!chat.name;
  $('chatWho').hidden = !has; $('chatMsgStep').hidden = !has; $('chatNameStep').hidden = has; $('chatMe').textContent = chat.name;
}
function showError(msg) { const e = $('chatError'); e.textContent = msg || ''; e.hidden = !msg; }

function openChat(open) {
  chat.open = open; $('chatPanel').hidden = !open; $('chatBtn').setAttribute('aria-expanded', String(open));
  if (open) restorePanel(); // where the user left it (needs the panel shown to measure it)
  if (open) { setUnread(0); $('chatList').scrollTop = $('chatList').scrollHeight; (chat.name ? $('chatInput') : $('chatName')).focus(); }
}

function send(e) {
  e.preventDefault();
  if (!chat.name) {
    const n = $('chatName').value.replace(/\s+/g, ' ').trim();
    if (!n) { showError('Enter your name to start chatting'); $('chatName').focus(); return; }
    chat.name = n.slice(0, 40); write(chat.name); showName(); showError(''); $('chatInput').focus(); return;
  }
  const text = $('chatInput').value.trim(); if (!text) return;
  if (!chat.socket.connected) { showError('Not connected, trying again…'); return; }
  $('chatSend').disabled = true;
  chat.socket.timeout(5000).emit('chat:send', { name: chat.name, text }, (err, res) => {
    $('chatSend').disabled = false;
    if (err) return showError('The message did not go through');
    if (!res?.ok) return showError(res?.error || 'The message did not go through');
    showError(''); $('chatInput').value = ''; $('chatInput').focus();
  });
}

// ----- moving the panel: drag it by its header; this browser remembers where. Double-click the header to put
// it back in the corner. Not on narrow screens, where the panel spans the width.
const narrow = () => matchMedia('(max-width:760px)').matches;
function placePanel(x, y) {
  const el = $('chatPanel'), w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, x)), top = Math.max(8, Math.min(innerHeight - h - 8, y));
  Object.assign(el.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
  return { x: left, y: top };
}
function resetPanel() { Object.assign($('chatPanel').style, { left: '', top: '', right: '', bottom: '' }); try { localStorage.removeItem(POS_KEY); } catch (_) {} }
function restorePanel() {
  if (narrow()) { Object.assign($('chatPanel').style, { left: '', top: '', right: '', bottom: '' }); return; }
  let pos = null; try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (_) {}
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) placePanel(pos.x, pos.y);
}
function initDrag() {
  const head = $('chatPanel').querySelector('.chat-head');
  let drag = null;
  head.addEventListener('pointerdown', e => {
    if (narrow() || e.button !== 0 || e.target.closest('button')) return;
    const r = $('chatPanel').getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId); head.classList.add('dragging'); e.preventDefault();
  });
  head.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) placePanel(e.clientX - drag.dx, e.clientY - drag.dy); });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null; head.classList.remove('dragging');
    const r = $('chatPanel').getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (_) {}
  };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  head.addEventListener('dblclick', e => { if (!e.target.closest('button')) resetPanel(); });
  addEventListener('resize', () => { if (!$('chatPanel').hidden) restorePanel(); });
}

function initChat() {
  initDrag();
  chat.name = read(); showName();
  $('chatBtn').onclick = () => openChat(!chat.open);
  $('chatClose').onclick = () => openChat(false);
  $('chatRename').onclick = () => { chat.name = ''; showName(); $('chatName').value = read(); $('chatName').focus(); };
  $('chatForm').onsubmit = send;
  // keys typed in the chat stay in the chat (no camera moves or shortcuts); Esc closes it
  $('chatPanel').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') openChat(false); });
  const socket = chat.socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  socket.on('connect', () => showError(''));
  socket.on('disconnect', () => { $('chatOnline').textContent = 'Reconnecting…'; });
  socket.on('chat:history', list => { $('chatList').replaceChildren(); list.forEach(addMessage); });
  socket.on('chat:presence', ({ online }) => { $('chatOnline').textContent = `${online} online`; });
  socket.on('chat:message', m => { addMessage(m); if (!chat.open && m.name !== chat.name) setUnread(chat.unread + 1); });
}

export { initChat };
