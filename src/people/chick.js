import * as THREE from 'three';
import { rnd } from '../core/util.js';
import { stdMat } from '../character/gfx.js';
import { camera, scene } from '../render/renderer.js';
import { trike } from '../world/furniture/trike.js';

// Hazel's little yellow chick. Whenever she sits down it flutters up onto the table in front of her (her desk,
// a dining or meeting table, the bar...) and potters about there, stopping to peck; with no table in front of
// her (a sofa, the keyboard) it flies up and sits on her head instead; when she walks (or rides)
// it follows her trail a step behind; anywhere else it stays close to her on the floor. It goes home with her.
// Updated from her step (people/hazel.js).
const chick = { root: null, head: null, wings: [], pos: new THREE.Vector3(), y: 0, face: 0, goal: null, spot: null, wait: 0, t: 0, trail: [] };
const BEHIND = .55;   // metres behind her on her trail
const WANDER = .3;    // m/s pottering about
const DESK_Y = .765;  // her desk top

function makeChick() {
  const g = new THREE.Group(), yellow = stdMat('#ffd84a', .7), orange = stdMat('#f08a24', .6), black = stdMat('#111111', .3);
  const body = new THREE.Mesh(new THREE.SphereGeometry(.055, 14, 10), yellow); body.scale.set(1, .9, 1.15); body.position.y = .07; body.castShadow = true; g.add(body);
  const head = new THREE.Group(); head.position.set(0, .125, .035); g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(.038, 12, 10), yellow));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.011, .025, 6), orange); beak.rotation.x = Math.PI / 2; beak.position.set(0, -.004, .045); head.add(beak);
  [-1, 1].forEach(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(.006, 6, 4), black); e.position.set(s * .018, .01, .032); head.add(e); });
  const wings = [-1, 1].map(s => { const w = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), yellow); w.scale.set(.35, .75, 1); w.position.set(s * .053, .075, -.005); g.add(w); return w; });
  [-1, 1].forEach(s => { const f = new THREE.Mesh(new THREE.BoxGeometry(.012, .025, .02), orange); f.position.set(s * .02, .012, .01); g.add(f); });
  return { root: g, head, wings };
}

// The height of the table top at (x, z): the first thing straight down from above, if it is flat and at table
// height (null: floor, a chair back, a monitor...). People, the chick and the tricycle don't count.
const down = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
const ours = o => { for (; o; o = o.parent) if (o.userData.person || o === chick.root || o === trike.root) return true; return false; };
function tableAt(x, z) {
  down.set(from.set(x, 1.15, z), DOWN); down.camera = camera; // the room labels are sprites, which need it
  const hit = down.intersectObjects(scene.children, true).find(h => h.object.visible && !ours(h.object));
  return hit && hit.point.y > .35 && hit.point.y < 1.1 && hit.face && hit.face.normal.y > .9 ? hit.point.y : null;
}
// A point in front of someone sitting with facing `face`: `ahead` metres forward, `side` to the side.
const before = (pos, face, side, ahead) => new THREE.Vector3(pos.x + side * Math.cos(face) + ahead * Math.sin(face), 0, pos.z - side * Math.sin(face) + ahead * Math.cos(face));
// A spot to potter to (its y is the surface it stands on). Seated: on the table in front of her (at her own
// desk, between its front edge and the monitor), or on her head ({ perch: true }) with no table there. Not
// seated: the floor close to her.
function wanderGoal(p, seated) {
  if (seated && p.task?.spot === p.seat) {
    const s = p.seat, a = s.area, g = before(s.pos, s.face, rnd(-a.halfW + .1, a.halfW - .1), rnd(a.front + .08, a.z1 - .32));
    g.y = DESK_Y; return g;
  }
  if (seated) for (let i = 0; i < 8; i++) {
    const g = before(p.pos, p.face, rnd(-.35, .35), rnd(.4, .8)), y = tableAt(g.x, g.z);
    if (y != null) { g.y = y; return g; }
  }
  if (seated) return { perch: true };
  return p.pos.clone().add(new THREE.Vector3(rnd(-.5, .5), 0, rnd(-.5, .5)));
}
// Her trail point `BEHIND` metres back along where she walked (her own position if the trail is shorter).
function trailPoint(p) {
  let left = BEHIND, prev = p.pos;
  for (let i = chick.trail.length - 1; i >= 0; i--) {
    const q = chick.trail[i], d = prev.distanceTo(q);
    if (d >= left) return prev.clone().lerp(q, left / d);
    left -= d; prev = q;
  }
  return prev.clone();
}

const headBox = new THREE.Box3(), top = new THREE.Vector3();
// Sitting on her head: flies up (flapping) and stays there, facing where she faces, pecking now and then.
function perch(p, mdt) {
  const b = p.body.root; b.position.set(p.pos.x, 0, p.pos.z); b.rotation.y = p.face; b.updateMatrixWorld(true); // where she is now (as syncBody puts her)
  headBox.setFromObject(p.body.head); headBox.getCenter(top); top.y = headBox.max.y - .005;
  const k = Math.min(1, mdt * 6), far = flat(chick.pos, top) + Math.abs(top.y - chick.y);
  chick.pos.lerp(new THREE.Vector3(top.x, 0, top.z), k); chick.y += (top.y - chick.y) * k;
  if (far < .03) { chick.pos.set(top.x, 0, top.z); chick.y = top.y; } // sat down: move with her head
  chick.face = p.face;
  chick.root.position.set(chick.pos.x, chick.y, chick.pos.z); chick.root.rotation.y = chick.face;
  chick.head.rotation.x = Math.sin(chick.t * 2.3) > .8 ? .5 : 0;
  const flap = far > .03 ? Math.sin(chick.t * 30) * .6 : 0;
  chick.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.max(0, flap); });
}

// Distance on the floor plan (the chick's own height is kept apart, in chick.y).
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// `dt` real seconds (for the hops), `mdt` simulated seconds (for moving, like people do).
function chickStep(p, dt, mdt) {
  if (!chick.root) { Object.assign(chick, makeChick()); chick.root.visible = false; scene.add(chick.root); }
  const r = chick.root;
  if (p.state === 'away') { r.visible = false; chick.trail.length = 0; return; }
  if (!r.visible) { r.visible = true; chick.pos.copy(p.pos); chick.y = 0; chick.goal = null; }
  chick.t += dt;
  const walking = p.state === 'walking', seated = p.state === 'doing' && !!p.task?.spot?.sit;
  let goal, speed;
  if (walking) {
    const last = chick.trail[chick.trail.length - 1];
    if (!last || last.distanceTo(p.pos) > .05) { chick.trail.push(p.pos.clone()); if (chick.trail.length > 80) chick.trail.shift(); }
    goal = trailPoint(p); speed = Math.max(p.speed * 1.4, flat(chick.pos, goal) * 3); chick.goal = null;
  } else {
    chick.trail.length = 0;
    if (chick.spot !== p.task?.spot) { chick.spot = p.task?.spot; chick.goal = null; } // somewhere new: look again
    if (!chick.goal) chick.goal = wanderGoal(p, seated);
    if (chick.goal.perch) { perch(p, mdt); return; }
    if (flat(chick.pos, chick.goal) < .02) { // there: peck a while, then off somewhere else
      if (chick.wait <= 0) chick.wait = rnd(1, 3.5);
      else if ((chick.wait -= mdt) <= 0) chick.goal = wanderGoal(p, seated);
    }
    goal = chick.goal; speed = flat(chick.pos, p.pos) > 2 ? 1.6 : WANDER; // catch up if left behind
  }
  const to = goal.clone().sub(chick.pos); to.y = 0;
  const d = to.length(), step = Math.min(d, speed * mdt), moving = step > 1e-4 && d > .02;
  if (moving) { chick.pos.addScaledVector(to, step / d); chick.face = Math.atan2(to.x, to.z); }
  // up onto the table while she sits at one, down to the floor otherwise (flapping on the way)
  const toY = walking ? 0 : chick.goal?.y ?? 0, climbing = Math.abs(toY - chick.y) > .01;
  chick.y += (toY - chick.y) * Math.min(1, mdt * 5);
  // hop while moving; peck and flap now and then while still
  r.position.set(chick.pos.x, chick.y + (moving ? Math.abs(Math.sin(chick.t * 16)) * .025 : 0), chick.pos.z);
  r.rotation.y = chick.face;
  const peck = !moving && Math.sin(chick.t * 2.3) > .6;
  chick.head.rotation.x = peck ? .7 + Math.sin(chick.t * 20) * .15 : 0;
  const flap = moving || climbing || Math.sin(chick.t * .9) > .93 ? Math.sin(chick.t * 30) * .6 : 0;
  chick.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.max(0, flap); });
}

export { chickStep };
