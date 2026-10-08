import { settleOn } from '../camera/state.js';
import { camera } from '../render/renderer.js';
import { beginControl, ctl, driveLocomotion, endControl, tickPrompts } from '../player/control.js';
import { player, spawnPlayer } from '../player/player.js';
import { $ } from '../ui/dom.js';
import { select } from '../ui/person.js';

/* ================= First person ================= */
// Camera at the player's eyes. Movement, sitting and input are shared with third person (src/player).
let eye = 1.6;

function enterFP() {
  const p = spawnPlayer();
  select(null);
  p.task = null;
  beginControl('fp', p, { title: 'First person', keys: 'WASD or arrows to move · drag to look · Shift to run · E to sit or stand · V third person · Esc to exit' });
  ctl.pitchMin = -1.2; ctl.pitchMax = 1.2;
  eye = 1.6 * p.spec.scale;
  camera.fov = 68; camera.near = .05; camera.updateProjectionMatrix();
  p.body.root.visible = false; // you can't see your own head
  $('crosshair').hidden = false;
}
// Leave first-person mode (called by the camera controller when another mode takes over).
function leaveFP() {
  const p = player.person;
  endControl();
  camera.fov = 38; camera.near = .1; camera.updateProjectionMatrix();
  $('crosshair').hidden = true;
  if (p) { p.body.root.visible = true; p.task = null; settleOn(p); }
}
function fpUpdate(dt) {
  const p = player.person; if (!p) return;
  driveLocomotion(dt, p);
  p.face = p.faceGoal = player.sitting ? player.sitting.face : ctl.yaw;
  const eyeGoal = (player.sitting ? 1.2 : 1.6) * p.spec.scale; eye += (eyeGoal - eye) * (1 - Math.exp(-dt * 8));
  const bob = player.moving ? Math.abs(Math.sin(p.walkPhase)) * .03 : 0;
  camera.position.set(p.pos.x + Math.sin(ctl.yaw) * .1, eye + bob, p.pos.z + Math.cos(ctl.yaw) * .1);
  const cp = Math.cos(ctl.pitch);
  camera.lookAt(camera.position.x + Math.sin(ctl.yaw) * cp, camera.position.y + Math.sin(ctl.pitch), camera.position.z + Math.cos(ctl.yaw) * cp);
  tickPrompts(dt);
}

export { enterFP, fpUpdate, leaveFP };
