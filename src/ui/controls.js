import { goTo } from '../camera/spots.js';
import { freeCam, setView } from '../camera/controller.js';
import { zoomAt } from '../camera/orbit.js';
import { camGoal } from '../camera/state.js';
import { FULL_H, LOW_H } from '../config/plan.js';
import { rnd } from '../core/util.js';
import { makePerson, removePerson } from '../people/factory.js';
import { roster } from '../people/roster.js';
import { resetDay } from '../sim/day.js';
import { live, setMode } from '../sim/live.js';
import { labelState } from '../render/labels.js';
import { camera, renderer } from '../render/renderer.js';
import { people, sim } from '../sim/state.js';
import { $ } from './dom.js';
import { select } from './person.js';
import { wall } from '../world/helpers.js';
// Fullscreen for the whole page (the HUD stays usable). The button only shows where the browser supports it.
function toggleFullscreen() {
  try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); } catch (_) {}
}
function syncFullscreen() {
  const on = !!document.fullscreenElement, b = $('fsToggle');
  b.textContent = on ? 'Exit fullscreen' : 'Fullscreen'; b.setAttribute('aria-pressed', String(on)); b.title = (on ? 'Exit fullscreen' : 'Fullscreen') + ' (F)';
}
function setUiHidden(h) {
  document.body.classList.toggle('ui-hidden', h);
  const b = $('uiToggle'); b.textContent = h ? 'Show controls' : 'Hide controls'; b.setAttribute('aria-pressed', String(h)); b.title = (h ? 'Show' : 'Hide') + ' controls (H)';
  try { localStorage.setItem('officeSimUiHidden', h ? '1' : '0'); } catch (_) {}
}


function initControls() {
  
  // Controls
  $('moreBtn').onclick = e => { const o = $('more').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); e.currentTarget.textContent = o ? 'Fewer options' : 'More options'; };
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => goTo(b.dataset.go));
  document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => { const k = b.dataset.cam; if (k === 'left') { camGoal.yaw += Math.PI / 4; freeCam(); } if (k === 'right') { camGoal.yaw -= Math.PI / 4; freeCam(); } if (k === 'in') zoomAt(.82); if (k === 'out') zoomAt(1.22); });
  $('uiToggle').onclick = () => setUiHidden(!document.body.classList.contains('ui-hidden'));
  $('fsToggle').hidden = !document.fullscreenEnabled;
  $('fsToggle').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f' && document.fullscreenEnabled && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && !e.metaKey && !e.ctrlKey && !e.altKey) toggleFullscreen(); });
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'h' && e.target.tagName !== 'INPUT' && !e.metaKey && !e.ctrlKey) setUiHidden(!document.body.classList.contains('ui-hidden')); });
  try { if (localStorage.getItem('officeSimUiHidden') === '1') setUiHidden(true); } catch (_) {}
  // Live follows the real clock (and attendance); Simulate runs the office's own faster clock for everyone,
  // starting the day or the night, and can be paused and sped up
  const press = (sel, on) => document.querySelectorAll(sel).forEach(x => x.setAttribute('aria-pressed', String(on(x))));
  const simulate = when => { setMode('sim', when); resetDay(); press('[data-simtime]', x => x.dataset.simtime === when); };
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const mode = b.dataset.mode; if (mode === live.mode) return;
    if (mode === 'live') { setMode('live'); resetDay(); } else simulate('day');
    press('[data-mode]', x => x === b);
    $('simRow').hidden = mode === 'live'; $('play').textContent = sim.paused ? 'Play' : 'Pause';
    press('[data-speed]', x => +x.dataset.speed === sim.speed);
  });
  document.querySelectorAll('[data-simtime]').forEach(b => b.onclick = () => simulate(b.dataset.simtime));
  $('play').onclick = () => { sim.paused = !sim.paused; $('play').textContent = sim.paused ? 'Play' : 'Pause'; };
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { sim.speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('tWalls').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); wall.goal = on ? FULL_H : LOW_H; };
  $('tLabels').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); labelState.on = on; };
  if (roster.list) { $('staff').max = people.length; $('staff').value = people.length; $('staffVal').textContent = people.length; }
  $('staff').oninput = e => {
    const n = +e.target.value; $('staffVal').textContent = n;
    while (people.length < n) { const p = makePerson(); if (!p) break; if (sim.t < p.leaveAt - 30 && sim.t > 7 * 60 + 50) { p.arriveAt = sim.t + rnd(.1, 4); } }
    while (people.length > n) removePerson();
  };
  addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('play').click(); } if (e.key === 'Escape') select(null); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
}

export { initControls };
