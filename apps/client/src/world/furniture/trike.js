import * as THREE from 'three';
import { scene } from '../../render/renderer.js';
import { stdMat } from '../../character/gfx.js';

// Hazel's cow tricycle (people/hazelRide.js): a white frame, a pink seat, a cow's head on the front, a big
// pedalled front wheel and two small back wheels. Origin on the ground under the seat, facing +z. It is not
// baked with the furniture: it moves when she rides it. `trike.home` is where it is parked by her desk.
const trike = { root: null, front: null, backs: [], home: null };

const MAT = {
  white: stdMat('#f4f3ef', .45), pink: stdMat('#e83e9b', .45), black: stdMat('#1d1d20', .7), grip: stdMat('#2a2a2e', .8), eye: stdMat('#111111', .3),
};
const v = (x, y, z) => new THREE.Vector3(x, y, z);
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }
// A round bar from a to b.
function tube(parent, a, b, r = .014, mat = MAT.white) {
  const m = mesh(parent, new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8), mat);
  m.position.copy(a).add(b).multiplyScalar(.5);
  m.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
// A wheel turning about x: a black tyre with a pink hub. Returns its group, centred on the axle.
function wheel(parent, r, w, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const axle = geo => geo.rotateZ(Math.PI / 2);
  mesh(g, axle(new THREE.CylinderGeometry(r, r, w, 18)), MAT.black);
  mesh(g, axle(new THREE.CylinderGeometry(r * .62, r * .62, w + .006, 14)), MAT.pink);
  mesh(g, new THREE.BoxGeometry(w + .01, r * 1.5, .014), MAT.black); // a spoke, so it can be seen turning
  return g;
}

function makeTrike() {
  const g = new THREE.Group(); g.name = 'hazelTrike'; // (the browser checks find it by name)
  // wheels: the big front one carries the pedals
  const front = wheel(g, .16, .05, 0, .16, .36);
  [-1, 1].forEach(s => {
    mesh(front, new THREE.BoxGeometry(.012, .07, .018), MAT.black, s * .045, s * .035, 0);           // crank arms, opposite ways
    mesh(front, new THREE.BoxGeometry(.05, .014, .03), MAT.black, s * .075, s * .07, 0);              // pedals
  });
  const backs = [-1, 1].map(s => wheel(g, .1, .04, s * .2, .1, -.2));
  // frame
  tube(g, v(-.2, .1, -.2), v(.2, .1, -.2), .012);                         // back axle
  tube(g, v(0, .1, -.2), v(0, .25, -.02));                                // up to the seat
  tube(g, v(0, .2, -.1), v(0, .44, .3), .016);                            // main bar to the steering head
  [-1, 1].forEach(s => tube(g, v(0, .44, .3), v(s * .035, .16, .36), .011)); // fork
  tube(g, v(0, .44, .3), v(0, .56, .27));                                 // stem
  tube(g, v(-.21, .56, .27), v(.21, .56, .27), .012);                     // handlebar
  [-1, 1].forEach(s => tube(g, v(s * .17, .56, .27), v(s * .25, .56, .27), .018, MAT.grip));
  // seat with a back
  mesh(g, new THREE.BoxGeometry(.2, .03, .17), MAT.pink, 0, .27, -.01);
  const back = mesh(g, new THREE.BoxGeometry(.2, .12, .025), MAT.pink, 0, .33, -.1); back.rotation.x = -.25;
  // the cow on the front: round white body, head with a big pink snout, pink horns and ears
  const body = mesh(g, new THREE.SphereGeometry(.075, 14, 10), MAT.white, 0, .37, .37); body.scale.set(1, 1.1, .85);
  [-1, 1].forEach(s => mesh(g, new THREE.SphereGeometry(.025, 8, 6), MAT.pink, s * .06, .31, .4)); // feet
  const head = mesh(g, new THREE.SphereGeometry(.085, 16, 12), MAT.white, 0, .52, .37); head.scale.set(1.1, .95, .95);
  const snout = mesh(g, new THREE.SphereGeometry(.06, 14, 10), MAT.pink, 0, .48, .44); snout.scale.set(1.25, .85, .7);
  [-1, 1].forEach(s => {
    mesh(g, new THREE.SphereGeometry(.008, 6, 4), MAT.eye, s * .022, .485, .484);                      // nostrils
    mesh(g, new THREE.SphereGeometry(.014, 8, 6), MAT.eye, s * .038, .55, .445);                       // eyes
    const horn = mesh(g, new THREE.ConeGeometry(.016, .05, 8), MAT.pink, s * .05, .615, .36); horn.rotation.z = -s * .35;
    const ear = mesh(g, new THREE.SphereGeometry(.028, 8, 6), MAT.white, s * .1, .56, .35); ear.scale.set(1.4, .6, .5);
  });
  return { root: g, front, backs };
}

// Park it at `home` (a position and a facing): called by the desks, next to Hazel's high chair.
function buildTrike(pos, face) {
  const t = makeTrike();
  Object.assign(trike, t, { home: { pos: pos.clone(), face } });
  t.root.position.copy(pos); t.root.rotation.y = face;
  scene.add(t.root);
}

export { buildTrike, trike };
