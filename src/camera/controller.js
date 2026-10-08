import { angleMode } from './modes/angle.js';
import { firstPersonMode } from './modes/firstPerson.js';
import { followMode } from './modes/follow.js';
import { freeMode } from './modes/free.js';
import { topMode } from './modes/top.js';

// Camera modes: { id, enter(ctrl, opts), exit(ctrl), update(dt, ctrl) }.
// Add a new view by writing a mode and registering it in initCamera().
const modes = new Map();
let current = null;
const ctrl = { setView, update: updateCamera };

function initCamera() {
  for (const m of [angleMode, topMode, followMode, freeMode, firstPersonMode]) modes.set(m.id, m);
}

function setView(id, opts) {
  const next = modes.get(id); if (!next) throw new Error('unknown camera mode: ' + id);
  if (id === 'fp' && current === next) return;
  if (current && current.exit) current.exit(ctrl);
  current = next;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  if (next.enter) next.enter(ctrl, opts);
}

// Per-frame: let the active mode move the camera.
function updateCamera(dt) { if (current) current.update(dt, ctrl); }

const viewId = () => current ? current.id : null;
// Person the camera is following, or null.
const following = () => current === followMode ? followMode.target : null;
// Follow `p`, or retarget if already following.
function follow(p) { if (current === followMode) followMode.target = p; else setView('follow', { target: p }); }
// Manual camera input: leave any preset or follow and go free.
function freeCam() { if (viewId() !== 'free') setView('free'); }

export { follow, following, freeCam, initCamera, setView, updateCamera, viewId };
