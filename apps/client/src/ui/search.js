import { follow } from '../camera/controller.js';
import { camGoal } from '../camera/state.js';
import { addLog, people } from '@office/shared';
import { $ } from './dom.js';
import { fmt, select } from './person.js';

/* ================= Find someone ================= */
// The search box at the bottom left: type part of a name, pick a match, and the camera goes to them
// and opens their card (where "Edit character" is).
const MAX_MATCHES = 6;

// Names that contain every typed word (first or last name, any order, any case).
function matches(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return people.filter(p => { const n = p.name.toLowerCase(); return words.every(w => n.includes(w)); })
    .sort((a, b) => a.name.localeCompare(b.name));
}
const whereabouts = p => p.toiletUntil ? 'Deploying to the toilet' : p.absent ? 'Not in today' : p.state !== 'away' ? (p.title ?? p.role) : p.arrivedAt ? 'Gone home' : `In around ${fmt(p.arriveAt)}`;

function render() {
  const box = $('officeMatches'), found = matches($('officeSearchInput').value);
  box.hidden = !$('officeSearchInput').value.trim();
  box.replaceChildren(...found.slice(0, MAX_MATCHES).map(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'os-match'; b.setAttribute('role', 'option');
    const name = document.createElement('span'); name.textContent = p.name;
    const info = document.createElement('span'); info.className = 'os-info'; info.textContent = whereabouts(p);
    b.append(name, info); b.onclick = () => goTo(p);
    return b;
  }));
  if (!found.length) { const none = document.createElement('div'); none.className = 'os-info'; none.textContent = 'No one by that name in the office.'; box.append(none); }
}

// Open their card; if they're in, fly the camera over and follow them.
function goTo(p) {
  $('officeSearchInput').value = ''; render(); $('officeSearchInput').blur();
  select(p);
  if (p.state === 'away') { addLog(p.absent ? `${p.name} isn't in today` : p.toiletUntil ? `${p.name} is in the toilet` : p.arrivedAt ? `${p.name} has gone home` : `${p.name} isn't in yet, due around ${fmt(p.arriveAt)}`); return; }
  follow(p); camGoal.dist = 7; camGoal.pitch = .7; camGoal.yaw = p.face + Math.PI + .5;
}

function initSearch() {
  const input = $('officeSearchInput');
  input.oninput = render;
  input.onkeydown = e => {
    if (e.key === 'Enter') $('officeMatches').querySelector('button')?.click();
    if (e.key === 'Escape') { input.value = ''; render(); input.blur(); }
  };
}

export { initSearch };
