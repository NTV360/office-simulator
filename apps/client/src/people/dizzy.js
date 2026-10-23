import { slap } from "@office/shared";
import * as THREE from "three";
import { stdMat } from "../character/gfx.js";
import { scene } from "../render/renderer.js";

// Cartoon birds circling the head of someone who took a slap and stayed up (sim/slap.js sets `p.dizzy`).
// A ring of birds per dizzy person, made the first time it is needed and reused.
const rings = [];
const BIRDS = 3,
  RADIUS = 0.2,
  ABOVE = 0.2; // metres: round the head, above the eyes
const NONE = [];

function makeBird(yellow, orange) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), yellow);
  body.scale.set(1, 0.85, 1.3);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), yellow);
  head.position.set(0, 0.022, 0.03);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.018, 6), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.02, 0.056);
  g.add(beak);
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), yellow);
    w.scale.set(1, 0.2, 0.7);
    w.position.set(s * 0.03, 0.01, 0);
    g.add(w);
    return w;
  });
  return { g, wings };
}
function makeRing() {
  const group = new THREE.Group(),
    yellow = stdMat("#ffd84a", 0.6),
    orange = stdMat("#f08a24", 0.6);
  const birds = Array.from({ length: BIRDS }, (_, i) => {
    const b = makeBird(yellow, orange),
      a = (i / BIRDS) * Math.PI * 2;
    b.g.position.set(Math.cos(a) * RADIUS, 0, -Math.sin(a) * RADIUS);
    b.g.rotation.y = a; // flying round, nose along the circle
    group.add(b.g);
    return b;
  });
  scene.add(group);
  return { group, birds, t: 0 };
}

// Per frame: put a ring over each dizzy fighter's head, spinning, wings flapping. Not over your own head in
// first person (your body is hidden then).
function updateDizzy(dt) {
  let n = 0;
  for (const m of slap.matches)
    for (const p of m.fighters ?? NONE) {
      if (!p.dizzy || !p.body.root.visible) continue;
      const r = (rings[n] ??= makeRing());
      n++;
      r.t += dt;
      r.group.visible = true;
      r.group.position.set(
        p.pos.x,
        p.body.eyeY + ABOVE + Math.sin(r.t * 4) * 0.02,
        p.pos.z,
      );
      r.group.rotation.y = r.t * 3.5;
      for (let i = 0; i < BIRDS; i++) {
        const w = r.birds[i].wings,
          f = Math.sin(r.t * 28 + i) * 0.7;
        w[0].rotation.z = f;
        w[1].rotation.z = -f;
      }
    }
  for (let i = n; i < rings.length; i++) rings[i].group.visible = false;
}

export { updateDizzy };
