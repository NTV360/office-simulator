import './styles/reset.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/hud.css';
import './styles/login.css';
import './styles/chat.css';
import './styles/controls.css';
import './styles/ledger.css';
import './styles/person.css';
import './styles/ui-toggle.css';
import './styles/search.css';
import './styles/creator.css';
import './styles/first-person.css';
import './styles/veil.css';
import './styles/responsive.css';

import { bootstrap } from './bootstrap.js';
import { fingerprint, screenMismatches } from './debug.js';
import { OBS, STATIC_SHAPES, TOPS } from './world/helpers.js';
import { ENTRY, findPath, presetList, spotsToLayout, GC, GR, interactables, log, NAV, objects, people, setSeed, sim, stepSim, toPx, walkPx } from '@office/shared';
import { keyCam } from './camera/input.js';
import { following, setView, updateCamera, viewId } from './camera/controller.js';
import { camGoal, camState } from './camera/state.js';
import { ctl } from './player/control.js';
import { tp } from './camera/modes/thirdPerson.js';
import { startOnline } from './net/online.js';
import { syncBody } from './people/sync.js';
import { player } from './player/player.js';
import { buildLabels, labelGroup, labelState } from './render/labels.js';
import { updateLight } from './render/lighting.js';
import { camera, renderer, scene } from './render/renderer.js';
import { peopleGroup } from './people/group.js';
import { addObjectView, objectDrawCalls } from './render/objects.js';
import { addObject, carriedBy, placementProblem, setObjectPose } from '@office/shared';
import { updateScreens } from './people/screens.js';
import { renderUI } from './ui/ledger.js';
import { selRing, select, selected } from './ui/person.js';
import { updateDarts } from './world/furniture/darts.js';
import { updateDiningTv } from './world/furniture/diningTv.js';
import { drawGame, gameCanvas, gameMat, loungeTV, loungeTVDefault } from './world/furniture/game.js';
import { updateGolf } from './world/furniture/golf.js';
import { updateMusic } from './world/furniture/music.js';
import { updateBucket } from './world/furniture/kitchen.js';
import { creator } from './ui/creator.js';
import { buildBody, disposeBody } from './character/rig.js';
import { scalers, wall } from './world/helpers.js';

// Development switch: ?seed=N makes the simulation repeatable (the same seed replays the same office day)
// and stops the live loop from advancing it, so scripted checks can step it themselves with __sim.advance().
const seedParam = new URLSearchParams(location.search).get('seed');
if (seedParam !== null) { setSeed(Number(seedParam)); sim.paused = true; }

// Online or offline? In the Docker stack the page is built with VITE_ONLINE=1 and is a viewer of the server's office.
// Anywhere else it runs its own office, as before, unless the address has ?online (same origin, e.g. the dev server
// proxying to a running server) or ?online=http://host:3000. ?offline forces the old way, and ?seed=N (scripted checks) always does.
const params = new URLSearchParams(location.search);
const forceOffline = seedParam !== null || params.has('offline');
const online = !forceOffline && (import.meta.env.VITE_ONLINE === '1' || params.has('online'));

bootstrap({ simulate: !online });
const live = online ? startOnline() : null;

/* ================= Main loop ================= */
let last = performance.now(), uiAcc = 0;
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (live) { live.frame(dt, now); updateScreens(); updateLight(); } // the server runs the simulation; paused or not, keep drawing
  else if (!sim.paused) {
    stepSim(dt);
    updateScreens(); updateLight();
  }
  for (const p of people) syncBody(p, dt);
  if (selected) { selRing.visible = selected.state !== 'away'; selRing.position.set(selected.pos.x, .02, selected.pos.z); const s = 1 + Math.sin(now / 260) * .06; selRing.scale.set(s, s, 1); }
  const showLabels = labelState.on && !ctl.active && camState.dist > 15; if (labelGroup.visible !== showLabels) labelGroup.visible = showLabels;
  if (Math.abs(wall.goal - wall.h) > .001) { wall.h += (wall.goal - wall.h) * (1 - Math.exp(-dt * 6)); scalers.forEach(f => f(wall.h)); }
  updateBucket(people);
  keyCam(dt); updateCamera(dt); updateGolf(); updateDarts(now); updateMusic(now);
  { const gaming = people.some(q => q.state === 'doing' && q.task?.kind === 'game') || (ctl.active && player.sitting?.game); const m = gaming ? gameMat : loungeTVDefault; if (loungeTV.material !== m) loungeTV.material = m; if (gaming) drawGame(dt); }
  updateDiningTv(dt, people.some(q => q.state === 'doing' && (q.task?.kind === 'tv' || (q.task?.kind === 'lunch' && q.task.spot?.kind === 'dining'))));
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
window.__sim = { net: live ? live.net : null, online, placementProblem, carriedBy, lab: creator, buildBody, disposeBody, presets: presetList().map(p => p.spec), renderer, scene, objects, peopleGroup, objectDrawCalls, stressObjects(n) { const made = []; for (let i = 0; i < n; i++) { const t = ['chair-office', 'chair-wood', 'stool-bar'][i % 3]; const o = addObject({ type: t, x: -45 + (i % 40) * 2.2, z: -20 + Math.floor(i / 40) * 1.6, rot: i, y: 0, variant: 0, station: null, spot: null }); addObjectView(o); made.push(o); } return made; }, shakeObjects(list, k) { for (const o of list) setObjectPose(o, o.x + Math.sin(k + o.index) * .01, o.z, o.rot + .02); }, layoutData: () => spotsToLayout(interactables.all(), OBS, objects.all(), TOPS), staticShapes: () => STATIC_SHAPES, fingerprint, screenMismatches, sim, people, player, ctl, tp, wall, interactables, NAV, GC, GR, camGoal, camState, updateCamera, viewId, following, select, setView, gameCanvas, drawGame, findPath, walkPx, toPx, ENTRY, advance(n, dt = .05) {
  for (let i = 0; i < n; i++) stepSim(dt);
}, log };
