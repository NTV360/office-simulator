import { EMOTE_KINDS, clipChat } from '@office/shared';
import { keys } from '../camera/input.js';
import { showBubble } from '../people/bubbles.js';
import { releaseSticks } from '../player/control.js';
import { clampPanel, defaultPanel, parsePanel } from './chat-layout.js';

// Local chat: the panel at the bottom left (the last lines, and a box that opens with Enter), a speech bubble over whoever spoke, and a history panel
// (everything said since you came in, with the time; drag it by its title, double-click the title to put it back).
// Everything the server sends is put in the page as text (textContent), never as markup.

const MAX_CHAT = 200;
const KEEP_LINES = 40;
const KEEP_HISTORY = 300;
const HISTORY_POS_KEY = 'office.chatHistory.pos';
const FADE_MS = 25_000;
const EMOTE_COOLDOWN_MS = 2500; // (the server's own limit; the buttons rest for as long)
const EMOTE_LABELS = { wave: 'Wave', cheer: 'Cheer', clap: 'Clap', nod: 'Nod' };

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};

/**
 * `send(text)` says something to the server. `personById(id)` finds a person on this page (for the bubble). The panel only shows while
 * `setActive(true)` (we are in the office).
 */
export function initChat({ send, sendEmote, personById }) {
  const log = el('div', { id: 'chatLog', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { id: 'chatInput', type: 'text', maxlength: String(MAX_CHAT), autocomplete: 'off', spellcheck: 'false', placeholder: 'Say something to people nearby…', 'aria-label': 'Chat message' });
  const form = el('form', { id: 'chatForm', hidden: '' }, input);
  const button = el('button', { id: 'chatBtn', class: 'chat-tool', type: 'button', title: 'Chat with people near you (Enter)' }, 'Chat');
  const emoteButtons = EMOTE_KINDS.map((kind, i) => el('button', { class: 'chat-tool emote', type: 'button', 'data-emote': kind, title: `${EMOTE_LABELS[kind]} (${i + 1})` }, EMOTE_LABELS[kind]));
  const historyButton = el('button', { id: 'chatHistoryBtn', class: 'chat-tool', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'chatHistory', title: 'Everything said since you came in' }, 'History');
  const tools = el('div', { id: 'chatTools' }, button, historyButton, ...emoteButtons);
  const root = el('div', { id: 'chat', hidden: '' }, log, form, tools);
  document.body.append(root);
  let active = false, typing = false;

  // The history panel: a card of its own, dragged by its title, kept inside the window, its place remembered.
  const historyList = el('ol', { id: 'chatHistoryList' });
  const historyClose = el('button', { class: 'chat-history-close', type: 'button', 'aria-label': 'Close chat history', title: 'Close' }, '\u00d7');
  const historyHead = el('header', { class: 'chat-history-head', title: 'Drag to move \u00b7 double-click to put back' }, el('span', {}, 'Chat history'), historyClose);
  const history = el('section', { id: 'chatHistory', class: 'card', hidden: '', 'aria-label': 'Chat history' }, historyHead, historyList);
  document.body.append(history);
  const savedPos = () => { try { return parsePanel(localStorage.getItem(HISTORY_POS_KEY)); } catch { return null; } };
  const savePos = pos => { try { if (pos) localStorage.setItem(HISTORY_POS_KEY, JSON.stringify(pos)); else localStorage.removeItem(HISTORY_POS_KEY); } catch { /* private window: it just starts in the corner next time */ } };
  const viewSize = () => ({ width: innerWidth, height: innerHeight });
  const panelSize = () => ({ width: history.offsetWidth, height: history.offsetHeight });
  function dockRect() { const d = document.getElementById('dock'); return d && d.offsetWidth > 0 ? d.getBoundingClientRect() : null; }
  function putHistory(pos) { history.style.left = pos.left + 'px'; history.style.top = pos.top + 'px'; }
  /** Stand the panel where it was left (kept inside the window), or in the corner. */
  function placeHistory() {
    if (history.hidden) return;
    const saved = savedPos();
    putHistory(saved ? clampPanel(saved, panelSize(), viewSize()) : defaultPanel(panelSize(), viewSize(), dockRect()));
  }
  function showHistory(on) {
    history.hidden = !on; historyButton.setAttribute('aria-expanded', String(on));
    if (on) { placeHistory(); historyList.scrollTop = historyList.scrollHeight; }
  }
  historyButton.addEventListener('click', () => showHistory(history.hidden));
  historyClose.addEventListener('click', () => showHistory(false));
  historyHead.addEventListener('dblclick', e => { if (e.target === historyClose) return; savePos(null); placeHistory(); });
  historyHead.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target === historyClose) return;
    const r = history.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    let moved = null;
    const move = ev => { moved = clampPanel({ left: ev.clientX - dx, top: ev.clientY - dy }, panelSize(), viewSize()); putHistory(moved); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); if (moved) savePos(moved); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    e.preventDefault(); // (no text selection while dragging)
  });
  history.addEventListener('keydown', e => { if (e.key === 'Escape') showHistory(false); });
  addEventListener('resize', placeHistory);
  const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function addHistory(who, text, kind) {
    const near = historyList.scrollHeight - historyList.scrollTop - historyList.clientHeight < 40;
    const item = el('li', { class: 'chat-line' + (kind ? ' ' + kind : '') }, el('time', {}, clock() + ' '));
    if (who) item.append(el('b', {}, who + ' '));
    item.append(el('span', {}, text)); // text, never markup
    historyList.append(item);
    while (historyList.children.length > KEEP_HISTORY) historyList.firstChild.remove();
    if (near) historyList.scrollTop = historyList.scrollHeight;
  }

  function addLine(who, text, kind = '') {
    addHistory(who, text, kind);
    const line = el('div', { class: 'chat-line' + (kind ? ' ' + kind : '') });
    if (who) line.append(el('b', {}, who + ' '));
    line.append(el('span', {}, text)); // text, never markup
    log.append(line);
    while (log.children.length > KEEP_LINES) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    setTimeout(() => line.classList.add('old'), FADE_MS);
  }

  function open() {
    if (!active || typing) return;
    typing = true; root.classList.add('typing'); form.hidden = false; button.hidden = true;
    keys.clear(); releaseSticks(); // (a movement key or the touch stick held when you open the box must not stay held while you type)
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
    input.value = ''; input.focus();
  }
  function close() {
    if (!typing) return;
    typing = false; root.classList.remove('typing'); form.hidden = true; button.hidden = !active;
    input.blur();
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send(clipChat(text));
    close();
  });
  button.addEventListener('click', open);
  function doEmote(kind) {
    if (!active || emoteButtons.some(b => b.disabled)) return;
    sendEmote(kind);
    emoteButtons.forEach(b => { b.disabled = true; });
    setTimeout(() => emoteButtons.forEach(b => { b.disabled = false; }), EMOTE_COOLDOWN_MS);
  }
  emoteButtons.forEach((b, i) => b.addEventListener('click', () => doEmote(EMOTE_KINDS[i])));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  addEventListener('keydown', e => {
    const digit = e.key >= '1' && e.key <= '9' ? Number(e.key) : 0;
    if (digit > 0 && digit <= EMOTE_KINDS.length && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) { // 1 to 4: the emotes
      const t = e.target && e.target.tagName;
      if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT' && !(e.target && e.target.isContentEditable) && !document.querySelector('.login-screen')) doEmote(EMOTE_KINDS[digit - 1]);
      return;
    }
    if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' || (e.target && e.target.isContentEditable)) return;
    if (e.target && e.target.closest && e.target.closest('a, summary, [role=button], dialog, [aria-modal="true"]')) return; // Enter belongs to that
    if (document.querySelector('.login-screen')) return; // the login or character page is up
    if (!active) return;
    e.preventDefault(); open();
  });

  return {
    /** A line from the server: show it in the panel and over the speaker. */
    receive(msg) {
      addLine(msg.name, msg.text);
      const p = personById(msg.from);
      if (p) showBubble(p, msg.text);
    },
    /** A line that is not from a person: an announcement or a private notice. */
    system(text, kind = 'notice') { addLine('', text, kind); },
    setActive(on) {
      active = on; root.hidden = !on;
      if (!on) { close(); showHistory(false); log.replaceChildren(); historyList.replaceChildren(); } // (nothing from one login is left for the next)
      else button.hidden = typing;
    },
  };
}
