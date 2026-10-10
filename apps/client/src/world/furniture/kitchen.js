import * as THREE from 'three';
import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { makeBucket } from '../../character/props.js';
import { SO, WST, mkSpot } from './basics.js';
import { addObs, addTop, box, boxGeo, cyl, dynamic, staticRoot } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

// The toilet bucket by the counter. `mesh` is the one on the floor: it is hidden while somebody has it out (see updateBucket).
const BUCKET = { mesh: null };


// Fruit on the counter: apples and an orange in the bowl, a bunch of bananas and a couple more beside it.
const FRUIT = {
  apple: new THREE.MeshStandardMaterial({ color: 0xc8302c, roughness: .45 }),
  apple2: new THREE.MeshStandardMaterial({ color: 0x7fb03a, roughness: .45 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xf08a1c, roughness: .7 }),
  banana: new THREE.MeshStandardMaterial({ color: 0xf2cf4a, roughness: .6 }),
  stem: new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: .8 }),
};
const ball = (g, r, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
const stem = (g, x, y, z) => box(g, .008, .025, .008, FRUIT.stem, x, y, z, false);
// The counter's things are items now (shared/world/catalogue.ts); these draw each one at its origin, on the counter top.
/** The bowl with its apples and orange (one item: the fruit stays in the bowl). */
function drawFruitBowl(g) {
  cyl(g, .14, .1, .08, M.diningWood2, 0, .04, 0, 14);
  [[-.05, -.04, FRUIT.apple], [.05, -.03, FRUIT.apple2], [0, .06, FRUIT.apple]].forEach(([dx, dz, mat]) => { ball(g, .042, mat, dx, .1, dz); stem(g, dx, .145, dz); });
  ball(g, .046, FRUIT.orange, .01, .15, .01);
}
/** A bunch of bananas: curved fingers joined at the stem. */
function drawBananas(g) {
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.TorusGeometry(.09, .016, 6, 14, 1.6), FRUIT.banana);
    b.rotation.set(Math.PI / 2, 0, -.8 + i * .14); b.position.set(-.02 + i * .012, .005 + i * .008, .02); b.castShadow = true; g.add(b);
  }
  box(g, .02, .02, .04, FRUIT.stem, .02, .015, -.05, false);
}
const drawApple = g => { ball(g, .042, FRUIT.apple, 0, .042, 0); stem(g, 0, .087, 0); };
const drawOrange = g => { ball(g, .046, FRUIT.orange, 0, .046, 0); };
/** The coffee machine, its drip tray and its red light. */
function drawCoffeeMachine(g) {
  box(g, .32, .4, .3, M.monitor, 0, .2, 0);
  box(g, .16, .02, .12, M.steel, .18, .07, 0, false);
  const led = new THREE.Mesh(boxGeo(.01, .03, .03), M.red); led.position.set(.17, .32, .04); g.add(led);
}

function buildKitchen() {
  
  // Counter top with coffee machine
  {
    addObs(351.8, 994.4, 429.5, 1034.4); addTop(351.8, 994.4, 429.5, 1034.4, .96);
    const cx = wx(390.65), cz = wz(1014.4), w = 77.7 * S, d = 40 * S;
    box(staticRoot, w, .92, d, M.counter, cx, .46, cz);
    box(staticRoot, w + .04, .04, d + .04, M.deskTop, cx, .94, cz);
    // what stands on it: items, put on the counter top (.96) at these places, in metres from its middle
    const on = (type, dx, dz) => placeLater(() => placeObject(type, 390.65 + dx / S, 1014.4 + dz / S, 0, { y: .96 }));
    on('coffee-machine', .55, -.3);
    on('water-jug', .7, .35);
    on('toaster', -.6, -.25);
    for (let i = 0; i < 4; i++) on('cup-small', .25, -.2 + i * .1);
    on('fruit-bowl', -.1, .25);
    on('bananas', -.46, .28);
    on('orange', .1, .38);
    on('apple', .2, .32);
    mkSpot('counter', 442, 1004, WST, { place: 'the counter' }); mkSpot('counter', 442, 1024, WST, { place: 'the counter' });
  }
  // Sink
  {
    addObs(351.8, 1061.1, 437.3, 1083.3);
    const cx = wx(394.55), cz = wz(1072.2), w = 85.5 * S, d = 22.2 * S;
    box(staticRoot, w, .88, d, M.sinkCab, cx, .44, cz);
    box(staticRoot, w + .02, .04, d + .02, M.deskTop, cx, .9, cz);
    box(staticRoot, .55, .03, .4, M.steel, wx(370.3), .925, cz, false);
    cyl(staticRoot, .02, .02, .3, M.steel, wx(370.3), 1.07, cz + .26, 8);
    box(staticRoot, .03, .03, .16, M.steel, wx(370.3), 1.21, cz + .19);
    mkSpot('sink', 374, 1049, SO, { place: 'the sink' }); mkSpot('sink', 408, 1049, SO, { place: 'the sink' });
  }
  // Snack cabinet on the wall above the sink, with a spot in front to grab something from it
  {
    const cx = wx(392), cz = wz(1083.3) - .2, w = 1.3;
    box(staticRoot, w, .62, .36, M.sinkCab, cx, 1.78, cz);
    [-1, 1].forEach(s => { box(staticRoot, w / 2 - .03, .56, .02, M.deskTop, cx + s * w / 4, 1.78, cz - .19, false); box(staticRoot, .02, .14, .03, M.steel, cx + s * .05, 1.7, cz - .2, false); });
    mkSpot('snack', 391, 1049, SO, { place: 'the snack cabinet' });
  }
  // The green bucket on the floor at the counter's corner by the wall, with a spot to grab it from
  {
    const b = makeBucket(); b.position.set(wx(358), 0, wz(986)); b.traverse(o => dynamic(o)); staticRoot.add(b);
    BUCKET.mesh = b; b.userData.isFloorBucket = true; // (a check in the browser tests finds it by this)
    mkSpot('bucket', 368, 986, WST, { place: 'the bucket' });
  }
}

/** The floor bucket is there unless somebody has it (in hand, or out of the building with it). Cheap: once a frame. */
function updateBucket(people) {
  if (!BUCKET.mesh) return;
  let taken = false;
  for (const p of people) if (p.props.bucket) { taken = true; break; }
  if (BUCKET.mesh.visible === taken) BUCKET.mesh.visible = !taken;
}

export { buildKitchen, drawApple, drawBananas, drawCoffeeMachine, drawFruitBowl, drawOrange, updateBucket };
