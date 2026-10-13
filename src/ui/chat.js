import { io } from 'socket.io-client';
import { $ } from './dom.js';

/* ================= Office chat ================= */
// One room for everyone using the app, over Socket.IO (server/chat.js). Newcomers get the recent messages.
// People must pick a display name before they can chat (the message box appears after); this browser
// remembers it. "Chat" in the dock opens the panel
// and shows a badge for messages that arrived while it was closed.
const NAME_KEY = 'officeSim.chatName';
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

function initChat() {
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
