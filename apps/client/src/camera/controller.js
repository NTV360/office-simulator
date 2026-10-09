import { canPlay } from '../player/player.js';
import { angleMode } from './modes/angle.js';
import { firstPersonMode } from './modes/firstPerson.js';
import { followMode } from './modes/follow.js';
import { thirdPersonMode } from './modes/thirdPerson.js';
import { freeMode } from './modes/free.js';
import { topMode } from './modes/top.js';

// Camera modes: { id, enter(ctrl, opts), exit(ctrl), update(dt, ctrl) }.
// Add a new view by writing a mode and registering it in initCamera().
const modes = new Map();
let current = null;
const ctrl = { setView, update: updateCamera, nextId: null };

function initCamera() {
  for (const m of [angleMode, topMode, followMode, freeMode, firstPersonMode, thirdPersonMode]) modes.set(m.id, m);
}

function setView(id, opts) {
  const next = modes.get(id); if (!next) throw new Error('unknown camera mode: ' + id);
  if ((id === 'fp' || id === 'third') && !canPlay()) return; // online and not yet told which person is yours
  if ((id === 'fp' || id === 'third') && current === next) return;
  ctrl.nextId = id; // lets a mode know where we are going (e.g. keep your seat when swapping first/third person)
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
