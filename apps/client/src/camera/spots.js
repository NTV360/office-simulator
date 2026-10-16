import * as THREE from 'three';
import { follow, following, setView, viewId } from './controller.js';
import { camGoal } from './state.js';
import { interactables, people, W } from '@office/shared';
import { player } from '../player/player.js';
import { ctl } from '../player/control.js';
import { camera, scene } from '../render/renderer.js';
import { deskAreas } from '../world/furniture/desks.js';
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

// The desk seat whose chair, desk section or monitor is at this world point (null: none). Desks are baked into a few merged meshes, so they are
// found by where the click landed (each seat's area, world/furniture/desks.js).
function deskAt(pt) {
  if (pt.y < .25) return null; // the floor around a chair is not the chair
  for (const s of interactables.of('desk')) {
    const a = deskAreas.get(s.id); if (!a) continue;
    const dx = pt.x - s.pos.x, dz = pt.z - s.pos.z, c = Math.cos(s.face), sn = Math.sin(s.face);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // into the seat's frame: +z toward the desk
    if (Math.abs(lx) <= a.halfW && lz >= a.z0 && lz <= a.z1) return s;
  }
  return null;
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(x, y) {
  if (ctl.active) return;
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(people.filter(p => p !== player.person && p.state !== 'away').map(p => p.body.root), true);
  const hit = hits.find(h => h.object.userData.person);
  if (hit) { select(hit.object.userData.person); if (viewId() === 'follow') follow(selected); }
  else if (!following()) { // nobody: a desk shows whoever sits there
    const at = ray.intersectObjects(scene.children, true).find(h => h.object.visible && !h.object.userData.person);
    select((at && deskAt(at.point)?.owner) ?? null);
  }
}

export { goTo, pickAt, ray };
