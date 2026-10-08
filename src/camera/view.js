import * as THREE from 'three';
import { pick } from '../core/util.js';
import { enterFP, exitFP, fp } from '../fp/firstPerson.js';
import { camera } from '../render/renderer.js';
import { people } from '../sim/state.js';
import { select, selected } from '../ui/person.js';

/* ================= Camera control ================= */
const camState = { target: new THREE.Vector3(0, 0, 1), dist: 44, yaw: .55, pitch: .92 };
const camGoal = { target: camState.target.clone(), dist: 44, yaw: .55, pitch: .92 };
let view = 'angle', followP = null;
function fitDist(pitch) {
  const asp = innerWidth / innerHeight, vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const needV = 23.5 / Math.tan(vf), hf = Math.atan(Math.tan(vf) * asp), needH = 13.5 / Math.tan(hf);
  return Math.max(needV * (pitch > 1.3 ? 1 : .74), needH * (pitch > 1.3 ? 1 : .8)) * (innerWidth < 760 ? 1.22 : 1);
}
function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (v === 'angle') { followP = null; Object.assign(camGoal, { yaw: .55, pitch: .92 }); camGoal.dist = fitDist(.92); camGoal.target.set(innerWidth > 760 ? -1.5 : 0, 0, innerWidth > 760 ? 3.2 : -1.8); }
  if (v === 'top') { followP = null; Object.assign(camGoal, { yaw: 0, pitch: 1.48 }); camGoal.dist = fitDist(1.48); camGoal.target.set(innerWidth > 760 ? -1.8 : 0, 0, innerWidth > 760 ? 0.6 : -5); }
  if (v !== 'fp' && fp.on) exitFP();
  if (v === 'fp') { enterFP(); return; }
  if (v === 'follow') {
    followP = selected && selected.state !== 'away' ? selected : pick(people.filter(p => p.state !== 'away')) || null;
    if (followP) { select(followP); camGoal.dist = 8; camGoal.pitch = .62; }
  }
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmpV = new THREE.Vector3(), tmpN = new THREE.Vector2(), tmpRay = new THREE.Raycaster();
function groundAt(x, y) { tmpN.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); tmpRay.setFromCamera(tmpN, camera); return tmpRay.ray.intersectPlane(groundPlane, tmpV) ? tmpV.clone() : null; }
function setViewPressed(v) { view = v || 'free'; document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v))); }
function freeCam() { if (followP) followP = null; if (view !== 'free') setViewPressed(null); }
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
  if (before && !followP) { camGoal.target.lerp(before, 1 - real); camGoal.target.y = 0; clampTarget(); }
}

function setViewName(v) { view = v; }

function setFollowP(v) { followP = v; }

export { camGoal, camState, followP, freeCam, pan, rotate, setView, setViewPressed, view, zoomAt, setViewName, setFollowP };
