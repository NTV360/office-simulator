import { camGoal, camState, followP, setFollowP, setViewPressed } from './view.js';
import { angDiff } from '../core/util.js';
import { fp } from '../fp/firstPerson.js';
import { camera } from '../render/renderer.js';

function updateCamera(dt) {
  if (fp.on) return;
  if (followP) {
    if (followP.state === 'away') { setFollowP(null); setViewPressed(null); }
    else camGoal.target.set(followP.pos.x, 0.8, followP.pos.z);
  }
  const k = 1 - Math.exp(-dt * (followP ? 5 : 7));
  camState.target.lerp(camGoal.target, k);
  camState.dist += (camGoal.dist - camState.dist) * k;
  camState.yaw += angDiff(camState.yaw, camGoal.yaw) * k;
  camState.pitch += (camGoal.pitch - camState.pitch) * k;
  const { target: t, dist: d, yaw, pitch } = camState;
  camera.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * d, t.y + Math.sin(pitch) * d, t.z + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(t);
}

export { updateCamera };
