import './styles/reset.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/hud.css';
import './styles/controls.css';
import './styles/hazel.css';
import './styles/ledger.css';
import './styles/person.css';
import './styles/ui-toggle.css';
import './styles/first-person.css';
import './styles/veil.css';
import './styles/responsive.css';

import { bootstrap } from './bootstrap.js';
import { keyCam } from './camera/input.js';
import { following, setView, updateCamera, viewId } from './camera/controller.js';
import { camGoal, camState } from './camera/state.js';
import { toPx } from './config/plan.js';
import { ctl } from './player/control.js';
import { dartsGame, updatePlayerDarts } from './player/darts.js';
import { tp } from './camera/modes/thirdPerson.js';
import { findPath } from './nav/astar.js';
import { GC, GR, NAV, walkPx } from './nav/grid.js';
import { rageShake, updateRage } from './people/hazel.js';
import { syncBody } from './people/sync.js';
import { player } from './player/player.js';
import { buildLabels, labelGroup, labelState } from './render/labels.js';
import { updateLight } from './render/lighting.js';
import { camera, renderer, scene } from './render/renderer.js';
import { newDay } from './sim/day.js';
import { tickMeetings, tryMeeting } from './sim/meetings.js';
import { CLOCK, log, people, sim } from './sim/state.js';
import { stepPerson, updateScreens } from './sim/step.js';
import { renderUI } from './ui/ledger.js';
import { selRing, select, selected } from './ui/person.js';
import { ENTRY } from './world/entrance.js';
import { interactables } from './world/interactables.js';
import { updateDarts } from './world/furniture/darts.js';
import { drawGame, gameCanvas, gameMat, loungeTV, loungeTVDefault } from './world/furniture/game.js';
import { updateGolf } from './world/furniture/golf.js';
import { updateMusic } from './world/furniture/music.js';
import { scalers, wall } from './world/helpers.js';

bootstrap();

/* ================= Main loop ================= */
let last = performance.now(), uiAcc = 0;
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!sim.paused) {
    sim.t += dt * sim.speed * CLOCK;
    if (Math.floor(sim.t) !== sim.lastMinute) { sim.lastMinute = Math.floor(sim.t); tryMeeting(); }
    tickMeetings();
    if (sim.t >= 19 * 60 + 10) newDay();
    for (const p of people) stepPerson(p, dt);
    updateScreens(); updateLight();
  }
  for (const p of people) syncBody(p, dt);
  if (player.person) syncBody(player.person, dt);
  if (selected) { selRing.visible = selected.state !== 'away'; selRing.position.set(selected.pos.x, .02, selected.pos.z); const s = 1 + Math.sin(now / 260) * .06; selRing.scale.set(s, s, 1); }
  const showLabels = labelState.on && !ctl.active && camState.dist > 15; if (labelGroup.visible !== showLabels) labelGroup.visible = showLabels;
  if (Math.abs(wall.goal - wall.h) > .001) { wall.h += (wall.goal - wall.h) * (1 - Math.exp(-dt * 6)); scalers.forEach(f => f(wall.h)); }
  updateRage(dt, now);
  keyCam(dt); updateCamera(dt); rageShake(now); updateGolf(); updateDarts(now); updatePlayerDarts(dt); updateMusic(now);
  { const gaming = people.some(q => q.state === 'doing' && q.task?.kind === 'game') || (ctl.active && player.sitting?.game); const m = gaming ? gameMat : loungeTVDefault; if (loungeTV.material !== m) loungeTV.material = m; if (gaming) drawGame(dt); }
  renderer.render(scene, camera);
  uiAcc += dt; if (uiAcc > .25) { uiAcc = 0; renderUI(); }
  requestAnimationFrame(tick);
}
scalers.forEach(f => f(wall.h));
updateLight(); setView('angle');
camState.target.copy(camGoal.target); camState.dist = camGoal.dist * 1.25; camState.yaw = camGoal.yaw + .5; camState.pitch = camGoal.pitch;
(document.fonts ? document.fonts.ready : Promise.resolve()).then(buildLabels, buildLabels);
renderUI();
requestAnimationFrame(t => { last = t; tick(t); });
window.__simReady = true;
document.getElementById('veil').classList.add('gone');
window.__sim = { sim, people, player, ctl, dartsGame, tp, wall, interactables, NAV, GC, GR, camGoal, camState, updateCamera, viewId, following, select, setView, gameCanvas, drawGame, findPath, walkPx, toPx, ENTRY, advance(n, dt = .05) {
  for (let i = 0; i < n; i++) { sim.t += dt * sim.speed * CLOCK; if (Math.floor(sim.t) !== sim.lastMinute) { sim.lastMinute = Math.floor(sim.t); tryMeeting(); } tickMeetings(); if (sim.t >= 19 * 60 + 10) newDay(); for (const p of people) stepPerson(p, dt); }
}, log };
