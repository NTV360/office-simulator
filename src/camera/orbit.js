import * as THREE from 'three';
import { camera } from '../render/renderer.js';
import { freeCam, following } from './controller.js';
import { camGoal, camState } from './state.js';

// Orbit-camera input operations (drag, rotate, wheel zoom). Any of them leaves follow/preset modes.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmpV = new THREE.Vector3(), tmpN = new THREE.Vector2(), tmpRay = new THREE.Raycaster();
function groundAt(x, y) { tmpN.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); tmpRay.setFromCamera(tmpN, camera); return tmpRay.ray.intersectPlane(groundPlane, tmpV) ? tmpV.clone() : null; }
function clampTarget() { camGoal.target.x = Math.max(-15, Math.min(15, camGoal.target.x)); camGoal.target.z = Math.max(-24, Math.min(25, camGoal.target.z)); }
function pan(dx, dy) {
  const s = 2 * camState.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight, yaw = camState.yaw;
  const sp = s / Math.max(.45, Math.sin(camState.pitch));
  camGoal.target.x += -dx * s * Math.cos(yaw) - dy * sp * Math.sin(yaw);
  camGoal.target.z += dx * s * Math.sin(yaw) - dy * sp * Math.cos(yaw);
  clampTarget(); freeCam();
}
function rotate(dx, dy) { camGoal.yaw -= dx * .006; camGoal.pitch = Math.max(.25, Math.min(1.5, camGoal.pitch + dy * .005)); freeCam(); }
function zoomAt(f, x, y) {
  const before = x === undefined ? null : groundAt(x, y);
  const nd = Math.max(3.5, Math.min(110, camGoal.dist * f)); const real = nd / camGoal.dist; camGoal.dist = nd;
  if (before && !following()) { camGoal.target.lerp(before, 1 - real); camGoal.target.y = 0; clampTarget(); }
}

export { pan, rotate, zoomAt };
