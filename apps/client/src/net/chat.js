import { clipChat } from '@office/shared';
import { keys } from '../camera/input.js';
import { showBubble } from '../people/bubbles.js';
import { releaseSticks } from '../player/control.js';

// Local chat: the panel at the bottom left (the last lines, and a box that opens with Enter), and a speech bubble over whoever spoke.
// Everything the server sends is put in the page as text (textContent), never as markup.

const MAX_CHAT = 200;
const KEEP_LINES = 40;
const FADE_MS = 25_000;

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
export function initChat({ send, personById }) {
  const log = el('div', { id: 'chatLog', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { id: 'chatInput', type: 'text', maxlength: String(MAX_CHAT), autocomplete: 'off', spellcheck: 'false', placeholder: 'Say something to people nearby…', 'aria-label': 'Chat message' });
  const form = el('form', { id: 'chatForm', hidden: '' }, input);
  const button = el('button', { id: 'chatBtn', type: 'button', title: 'Chat with people near you (Enter)' }, 'Chat');
  const root = el('div', { id: 'chat', hidden: '' }, log, form, button);
  document.body.append(root);
  let active = false, typing = false;

  function addLine(who, text, kind = '') {
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
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  addEventListener('keydown', e => {
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
      if (!on) { close(); log.replaceChildren(); } // (nothing from one login is left for the next)
      else button.hidden = typing;
    },
  };
}
