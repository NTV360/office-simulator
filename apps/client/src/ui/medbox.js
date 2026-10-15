import { MEDKIT_MAX, MEDKIT_REACH, objects } from '@office/shared';
import { player } from '../player/player.js';

// The medkit menu: press E at the medkit on the kitchen counter and a grid of what is in it appears (a bandage is one cell, a first-aid box two
// tall). Click an item to take it into your inventory. The server owns the stock and refills it (a bandage every 5 s, a first-aid box every 15 s);
// while the menu is open the page asks again once a second, so the counts follow. It closes if you walk away.

const REFRESH_MS = 1000;
const state = { send: null, revision: () => 0, index: null, contents: null, timer: 0 };
let panel = null, grid = null, title = null;

export function initMedbox({ send, revision }) {
  state.send = send; state.revision = revision;
  panel = document.createElement('section');
  panel.id = 'medboxPanel'; panel.className = 'card medbox-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Medkit');
  const head = document.createElement('div'); head.className = 'medbox-head';
  title = document.createElement('strong'); title.textContent = 'Medkit';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'btn'; close.textContent = 'Close'; close.id = 'medboxClose';
  close.addEventListener('click', closeMedbox);
  head.append(title, close);
  grid = document.createElement('div'); grid.id = 'medboxGrid'; grid.className = 'medbox-grid'; grid.setAttribute('role', 'grid');
  const hint = document.createElement('small'); hint.textContent = 'Click an item to take it. The box fills up again by itself.';
  panel.append(head, grid, hint);
  document.body.append(panel);
}

export const medboxOpen = () => state.index !== null;
export const medboxIndex = () => state.index;

/** Open (or, if it is already open, close) the menu for the medkit with this object index. */
export function toggleMedbox(index) {
  if (state.index === index) { closeMedbox(); return; }
  state.index = index; state.contents = null;
  draw();
  panel.hidden = false;
  ask();
  clearInterval(state.timer);
  state.timer = setInterval(tick, REFRESH_MS);
}

export function closeMedbox() {
  state.index = null; state.contents = null;
  clearInterval(state.timer); state.timer = 0;
  if (panel) panel.hidden = true;
}

const ask = () => state.send?.({ type: 'inventory', action: 'medkit-open', object: state.index, revision: state.revision() });

function tick() {
  const o = state.index === null ? null : objects.at(state.index), me = player.person;
  // (it closes a little inside the real reach, so the server is never asked from outside it)
  if (!o || !me || player.sitting || Math.hypot(o.x - me.pos.x, o.z - me.pos.z) > MEDKIT_REACH - .15) { closeMedbox(); return; }
  ask();
}

/** The server's word on what the box holds now: `object,bandages,first-aid boxes`; or `closed`, when it cannot be used from here any more. */
export function medkitNote(text) {
  if (text === 'closed') { closeMedbox(); return; }
  const [object, bandage, kit] = text.split(',').map(Number);
  if (![object, bandage, kit].every(Number.isInteger) || object !== state.index) return;
  state.contents = { bandage, 'first-aid-box': kit };
  draw();
}

function draw() {
  if (!grid) return;
  grid.replaceChildren();
  const c = state.contents;
  title.textContent = c ? `Medkit · ${c.bandage} bandages · ${c['first-aid-box']} first-aid` : 'Medkit';
  if (!c) return;
  const cell = (kit, label, rows) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `medbox-item ${kit}`; b.textContent = label; b.title = `Take a ${label.toLowerCase()}`;
    if (rows > 1) b.style.gridRow = `span ${rows}`;
    b.addEventListener('click', () => state.send?.({ type: 'inventory', action: 'medkit-take', object: state.index, kit, revision: state.revision() }));
    return b;
  };
  // bandages first, two rows of five; then the first-aid boxes, two cells tall each (the most the box holds is drawn as empty slots)
  for (let i = 0; i < MEDKIT_MAX.bandage; i++) {
    if (i < c.bandage) grid.append(cell('bandage', 'Bandage', 1)); else grid.append(Object.assign(document.createElement('div'), { className: 'medbox-empty' }));
  }
  for (let i = 0; i < MEDKIT_MAX['first-aid-box']; i++) {
    if (i < c['first-aid-box']) grid.append(cell('first-aid-box', 'First-aid box', 2));
    else { const e = document.createElement('div'); e.className = 'medbox-empty'; e.style.gridRow = 'span 2'; grid.append(e); }
  }
}
