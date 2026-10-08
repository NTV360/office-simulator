import * as THREE from 'three';
import { follow, following, setView, viewId } from './controller.js';
import { camGoal } from './state.js';
import { W, isStaff } from '@office/shared';
import { ctl } from '../player/control.js';
import { camera } from '../render/renderer.js';
import { people } from '../sim/state.js';
import { select, selected } from '../ui/person.js';

// Jump-to spots
const SPOTS = {
  pantry: { px: [520, 1030], dist: 13, yaw: 2.75, pitch: .72 },
  booths: { px: [582, 918], dist: 10, yaw: 2.85, pitch: .66 },
  desks: { px: [527, 400], dist: 15, yaw: .7, pitch: .8 },
  meeting: { px: [255, 160], dist: 15.5, yaw: .35, pitch: .9 },
  golf: { px: [660, 1020], dist: 7, yaw: -1.9, pitch: .62 },
  lounge: { px: [270, 330], dist: 13, yaw: .25, pitch: .72 },
};
function goTo(k) {
  const s = SPOTS[k]; setView('free');
  camGoal.target.copy(W(...s.px)); camGoal.dist = s.dist; camGoal.yaw = s.yaw; camGoal.pitch = s.pitch;
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(x, y) {
  if (ctl.active) return;
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(people.filter(p => isStaff(p) && p.state !== 'away').map(p => p.body.root), true);
  const hit = hits.find(h => h.object.userData.person);
  if (hit) { select(hit.object.userData.person); if (viewId() === 'follow') follow(selected); }
  else if (!following()) select(null);
}

export { goTo, pickAt, ray };
