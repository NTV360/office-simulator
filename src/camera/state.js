import * as THREE from 'three';
import { angDiff } from '../core/util.js';
import { camera } from '../render/renderer.js';

// Orbit camera: camGoal is where input wants it, camState is the smoothed result.
const camState = { target: new THREE.Vector3(0, 0, 1), dist: 44, yaw: .55, pitch: .92 };
const camGoal = { target: camState.target.clone(), dist: 44, yaw: .55, pitch: .92 };

function fitDist(pitch) {
  const asp = innerWidth / innerHeight, vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const needV = 23.5 / Math.tan(vf), hf = Math.atan(Math.tan(vf) * asp), needH = 13.5 / Math.tan(hf);
  return Math.max(needV * (pitch > 1.3 ? 1 : .74), needH * (pitch > 1.3 ? 1 : .8)) * (innerWidth < 760 ? 1.22 : 1);
}

// Ease camState toward camGoal and aim the camera. `rate` is how snappy the easing is.
function orbitStep(dt, rate) {
  const k = 1 - Math.exp(-dt * rate);
  camState.target.lerp(camGoal.target, k);
  camState.dist += (camGoal.dist - camState.dist) * k;
  camState.yaw += angDiff(camState.yaw, camGoal.yaw) * k;
  camState.pitch += (camGoal.pitch - camState.pitch) * k;
  const { target: t, dist: d, yaw, pitch } = camState;
  camera.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * d, t.y + Math.sin(pitch) * d, t.z + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(t);
}

// Park the free orbit camera on a person (used when leaving first/third person).
function settleOn(p) {
  camGoal.target.set(p.pos.x, 0, p.pos.z); camState.target.copy(camGoal.target);
  camGoal.dist = camState.dist = 12; camGoal.pitch = camState.pitch = .75; camGoal.yaw = camState.yaw = p.face + Math.PI;
}

export { camGoal, camState, fitDist, orbitStep, settleOn };
