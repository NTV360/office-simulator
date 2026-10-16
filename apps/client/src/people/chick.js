import * as THREE from 'three';
import { vrnd as rnd } from '@office/shared';
import { stdMat } from '../character/gfx.js';
import { camera, scene } from '../render/renderer.js';
import { deskAreas } from '../world/furniture/desks.js';
import { trike } from '../world/furniture/trike.js';

// Hazel's little yellow chick. Whenever she sits down it flutters up onto the table in front of her (her desk,
// a dining or meeting table, the bar...) and potters about there, stopping to peck; with no table in front of
// her (a sofa, the keyboard) it flies up and sits on her head instead; when she walks (or rides)
// it follows her trail a step behind; anywhere else it stays close to her on the floor. It goes home with her.
// Updated every frame from her body (people/hazel.js). Client-only: nothing here is simulated or sent.
const chick = { root: null, head: null, wings: [], pos: new THREE.Vector3(), y: 0, face: 0, goal: null, spot: null, hop: null, wait: 0, t: 0, trail: [] };
// (a person's position is the shared package's small Vec3, with no vector maths: these are Three.js copies of it)
const vec = v => new THREE.Vector3(v.x, v.y, v.z);
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
  g.name = 'hazelChick'; // (the browser checks find it by name)
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
  if (seated && p.task?.spot === p.slot) {
    const s = p.slot, a = deskAreas.get(s.id), g = before(s.pos, s.face, rnd(-a.halfW + .1, a.halfW - .1), rnd(a.front + .08, a.z1 - .32));
    g.y = DESK_Y; return g;
  }
  if (seated) for (let i = 0; i < 8; i++) {
    const g = before(p.pos, p.face, rnd(-.35, .35), rnd(.4, .8)), y = tableAt(g.x, g.z);
    if (y != null) { g.y = y; return g; }
  }
  if (seated) return { perch: true, t: 0, from: null };
  return vec(p.pos).add(new THREE.Vector3(rnd(-.5, .5), 0, rnd(-.5, .5)));
}
// Her trail point `BEHIND` metres back along where she walked (her own position if the trail is shorter).
function trailPoint(p) {
  let left = BEHIND, prev = vec(p.pos);
  for (let i = chick.trail.length - 1; i >= 0; i--) {
    const q = chick.trail[i], d = prev.distanceTo(q);
    if (d >= left) return prev.clone().lerp(q, left / d);
    left -= d; prev = q;
  }
  return prev.clone();
}

const headBox = new THREE.Box3(), top = new THREE.Vector3();
const JUMP = .55; // seconds for a jump: onto a table, onto her head, or down
// Sitting on her head: one flapping jump up in an arc from wherever it is, then it stays there, facing where
// she faces and pecking now and then. `g` is the perch goal ({ perch, t: 0..1 through the jump, from }).
function perch(p, g, mdt) {
  const b = p.body.root; b.position.set(p.pos.x, 0, p.pos.z); b.rotation.y = p.face; b.updateMatrixWorld(true); // where she is now (as syncBody puts her)
  headBox.setFromObject(p.body.head); headBox.getCenter(top); top.y = headBox.max.y - .005;
  g.from ??= { x: chick.pos.x, z: chick.pos.z, y: chick.y };
  g.t = Math.min(1, g.t + mdt / JUMP);
  const t = g.t, f = g.from;
  chick.pos.set(f.x + (top.x - f.x) * t, 0, f.z + (top.z - f.z) * t);
  chick.y = f.y + (top.y - f.y) * t + Math.sin(Math.PI * t) * .35; // up and over, landing on top
  if (t < 1) chick.face = Math.atan2(top.x - f.x, top.z - f.z); else chick.face = p.face;
  chick.root.position.set(chick.pos.x, chick.y, chick.pos.z); chick.root.rotation.y = chick.face;
  chick.head.rotation.x = t >= 1 && Math.sin(chick.t * 2.3) > .8 ? .5 : 0;
  const flap = t < 1 ? Math.sin(chick.t * 30) * .6 : 0;
  chick.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.max(0, flap); });
}

// One flapping jump in an arc from where it is to (x, y, z): up onto a table, or down to the floor. While a
// jump is going (chick.hop) nothing else moves the chick.
function hopTo(x, y, z) { chick.hop = { from: { x: chick.pos.x, y: chick.y, z: chick.pos.z }, to: { x, y, z }, t: 0 }; }
function stepHop(mdt) {
  const h = chick.hop, f = h.from, to = h.to;
  h.t = Math.min(1, h.t + mdt / JUMP);
  chick.pos.set(f.x + (to.x - f.x) * h.t, 0, f.z + (to.z - f.z) * h.t);
  chick.y = f.y + (to.y - f.y) * h.t + Math.sin(Math.PI * h.t) * .3;
  if (Math.hypot(to.x - f.x, to.z - f.z) > .01) chick.face = Math.atan2(to.x - f.x, to.z - f.z);
  chick.root.position.set(chick.pos.x, chick.y, chick.pos.z); chick.root.rotation.y = chick.face;
  chick.head.rotation.x = 0;
  chick.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.max(0, Math.sin(chick.t * 30) * .6); });
  if (h.t >= 1) { chick.y = to.y; chick.hop = null; }
}

// Distance on the floor plan (the chick's own height is kept apart, in chick.y).
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// `dt` real seconds (for the hops), `mdt` simulated seconds (for moving, like people do).
function chickStep(p, dt, mdt) {
  if (!chick.root) { Object.assign(chick, makeChick()); chick.root.visible = false; scene.add(chick.root); }
  const r = chick.root;
  if (p.state === 'away') { r.visible = false; chick.trail.length = 0; return; }
  if (!r.visible) { r.visible = true; chick.pos.copy(p.pos); chick.y = 0; chick.goal = null; chick.hop = null; }
  chick.t += dt;
  const walking = p.state === 'walking', seated = p.state === 'doing' && !!p.task?.spot?.sit;
  if (walking) { // keep her trail even mid-jump
    const last = chick.trail[chick.trail.length - 1];
    if (!last || last.distanceTo(p.pos) > .05) { chick.trail.push(vec(p.pos)); if (chick.trail.length > 80) chick.trail.shift(); }
  }
  if (chick.hop) { stepHop(mdt); return; }
  let goal, speed;
  if (walking) {
    if (chick.y > .05) { // she's off: jump down first, toward her
      const g = trailPoint(p), d = flat(chick.pos, g), k = d > .35 ? .35 / d : 1;
      hopTo(chick.pos.x + (g.x - chick.pos.x) * k, 0, chick.pos.z + (g.z - chick.pos.z) * k); chick.goal = null; return;
    }
    goal = trailPoint(p); speed = Math.max(p.speed * 1.4, flat(chick.pos, goal) * 3); chick.goal = null;
  } else {
    chick.trail.length = 0;
    if (chick.spot !== p.task?.spot) { chick.spot = p.task?.spot; chick.goal = null; } // somewhere new: look again
    if (!chick.goal) chick.goal = wanderGoal(p, seated);
    else if (!chick.goal.perch && flat(chick.pos, chick.goal) < .02) { // there: peck a while, then off somewhere else
      if (chick.wait <= 0) chick.wait = rnd(1, 3.5);
      else if ((chick.wait -= mdt) <= 0) chick.goal = wanderGoal(p, seated);
    }
    if (chick.goal.perch) { perch(p, chick.goal, mdt); return; } // (a new pick can be her head too)
    if (Math.abs(chick.goal.y - chick.y) > .1) { hopTo(chick.goal.x, chick.goal.y, chick.goal.z); return; } // up onto the table (or down) in one jump
    goal = chick.goal; speed = flat(chick.pos, p.pos) > 2 ? 1.6 : WANDER; // catch up if left behind
  }
  const to = goal.clone().sub(chick.pos); to.y = 0;
  const d = to.length(), step = Math.min(d, speed * mdt), moving = step > 1e-4 && d > .02;
  if (moving) { chick.pos.addScaledVector(to, step / d); chick.face = Math.atan2(to.x, to.z); }
  // hop while moving; peck and flap now and then while still
  r.position.set(chick.pos.x, chick.y + (moving ? Math.abs(Math.sin(chick.t * 16)) * .025 : 0), chick.pos.z);
  r.rotation.y = chick.face;
  const peck = !moving && Math.sin(chick.t * 2.3) > .6;
  chick.head.rotation.x = peck ? .7 + Math.sin(chick.t * 20) * .15 : 0;
  const flap = moving || Math.sin(chick.t * .9) > .93 ? Math.sin(chick.t * 30) * .6 : 0;
  chick.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.max(0, flap); });
}

export { chickStep };
