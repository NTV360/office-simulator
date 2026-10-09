import { goTo } from '../camera/spots.js';
import { freeCam, setView } from '../camera/controller.js';
import { zoomAt } from '../camera/orbit.js';
import { camGoal } from '../camera/state.js';
import { FULL_H, LOW_H, setStaffCount, sim } from '@office/shared';
import { updateScreens } from '../people/screens.js';
import { nameState } from '../people/nametags.js';
import { labelState } from '../render/labels.js';
import { camera, renderer } from '../render/renderer.js';
import { $ } from './dom.js';
import { select } from './person.js';
import { wall } from '../world/helpers.js';
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
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'h' && e.target.tagName !== 'INPUT' && !e.metaKey && !e.ctrlKey) setUiHidden(!document.body.classList.contains('ui-hidden')); });
  try { if (localStorage.getItem('officeSimUiHidden') === '1') setUiHidden(true); } catch (_) {}
  $('play').onclick = () => { sim.paused = !sim.paused; $('play').textContent = sim.paused ? 'Play' : 'Pause'; };
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { sim.speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('tWalls').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); wall.goal = on ? FULL_H : LOW_H; };
  $('tLabels').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); labelState.on = on; };
  $('tNames').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); nameState.on = on; };
  $('staff').oninput = e => {
    const n = +e.target.value; $('staffVal').textContent = n;
    setStaffCount(n);
    updateScreens(); // a paused simulation does not update monitors by itself
  };
  addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('play').click(); } if (e.key === 'Escape') select(null); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
}

export { initControls };
