import * as THREE from 'three';
import { deskSeats, wx, wz } from '@office/shared';
import { scene } from './renderer.js';

// Seat marks and the "where is my table" beacon. Every seat has its name (E7) printed on the desk top in front of its chair, as if on the
// desk, and it is only drawn while you are walking about near it (an office full of labels from the overview would be noise). The beacon is
// a tall soft beam of light on your own desk, on your page alone: nobody else sees it.

/** Marks are drawn within this distance of you (m), fading out over the last two. */
const NEAR = 6.5;
const DESK_TOP = .772, W = .26, H = .13;

const marks = [];
let built = false;
function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.72)'; g.beginPath(); g.roundRect(8, 8, 240, 112, 22); g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(40,54,78,.55)'; g.stroke();
  g.fillStyle = '#24324a'; g.font = '700 74px system-ui, -apple-system, Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function build() {
  built = true;
  const geo = new THREE.PlaneGeometry(W, H);
  for (const s of deskSeats()) {
    const [, y1, , y2] = s.island.rect, top = s.py < (y1 + y2) / 2;
    const py = top ? y1 + 2.4 : y2 - 2.4; // (just inside the desk edge, in front of the chair, clear of the keyboard)
    const mat = new THREE.MeshBasicMaterial({ map: label(s.id), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); // (drawn over the desk top, not fighting it)
    const m = new THREE.Mesh(geo, mat);
    // lying flat, the right way up for whoever sits there: a seat on the top side faces south, so its text points south (+z)
    m.rotation.set(-Math.PI / 2, 0, top ? Math.PI : 0);
    m.position.set(wx(s.px), DESK_TOP, wz(py)); m.renderOrder = 3; m.visible = false;
    scene.add(m); marks.push(m);
  }
}

// ---- the beacon
let beacon = null, beaconAt = null, beaconUntil = 0;
function makeBeacon() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(30,125,255,0)'); grad.addColorStop(.4, 'rgba(30,125,255,.55)'); grad.addColorStop(1, 'rgba(20,105,245,.95)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 16, 20, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 8; beam.renderOrder = 5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.3, .46, 36), new THREE.MeshBasicMaterial({ color: 0x1f7dff, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 5;
  const group = new THREE.Group(); group.add(beam, ring); group.visible = false; scene.add(group);
  return { group, beam, ring };
}
/** Show the beacon on a desk (a spot with a position), for a while. It goes by itself when you get there. Your page alone. */
export function showDeskBeacon(spot, seconds = 14) {
  if (!spot?.pos) return;
  beacon ??= makeBeacon();
  beaconAt = { x: spot.pos.x, z: spot.pos.z }; beaconUntil = performance.now() + seconds * 1000;
  beacon.group.position.set(beaconAt.x, 0, beaconAt.z); beacon.group.visible = true;
}
export function hideDeskBeacon() { beaconAt = null; if (beacon) beacon.group.visible = false; }

/**
 * Once a frame. `at` is where you are walking (x, z) or null when you are not (the overview camera): then no marks are drawn.
 * `now` is the frame's time in ms.
 */
export function updateDeskMarks(at, now) {
  if (!built) build();
  for (const m of marks) {
    if (!at) { if (m.visible) m.visible = false; continue; }
    const d = Math.hypot(m.position.x - at.x, m.position.z - at.z), o = Math.max(0, Math.min(1, (NEAR - d) / 2));
    if (o <= 0) { if (m.visible) m.visible = false; continue; }
    m.material.opacity = o; if (!m.visible) m.visible = true;
  }
  if (beacon && beaconAt) {
    const near = at && Math.hypot(beaconAt.x - at.x, beaconAt.z - at.z) < 1.3; // (you are there: it has done its job)
    if (near || now > beaconUntil) { hideDeskBeacon(); return; }
    const pulse = .75 + Math.sin(now / 280) * .25, s = 1 + (Math.sin(now / 420) * .5 + .5) * .5;
    beacon.beam.material.opacity = pulse; beacon.ring.scale.set(s, s, 1); beacon.ring.material.opacity = .9 - (s - 1) * .8;
  }
}
