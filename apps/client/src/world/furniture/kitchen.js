import * as THREE from 'three';
import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { makeBucket } from '../../character/props.js';
import { SO, WST, mkSpot } from './basics.js';
import { addObs, addTop, box, boxGeo, cyl, dynamic, staticRoot } from '../helpers.js';

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
function fruit(cx, cz) {
  const ball = (r, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat); m.position.set(x, y, z); m.castShadow = true; staticRoot.add(m); return m; };
  const stem = (x, y, z) => box(staticRoot, .008, .025, .008, FRUIT.stem, x, y, z, false);
  // in the bowl (centre cx - .1, cz + .25, rim at about 1.03)
  [[-.15, .21, FRUIT.apple], [-.05, .22, FRUIT.apple2], [-.1, .31, FRUIT.apple]].forEach(([dx, dz, mat]) => { ball(.042, mat, cx + dx, 1.05, cz + dz); stem(cx + dx, 1.095, cz + dz); });
  ball(.046, FRUIT.orange, cx - .09, 1.1, cz + .26);
  // a bunch of bananas: curved fingers joined at the stem
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.TorusGeometry(.09, .016, 6, 14, 1.6), FRUIT.banana);
    b.rotation.set(Math.PI / 2, 0, -.8 + i * .14); b.position.set(cx - .48 + i * .012, .965 + i * .008, cz + .3); b.castShadow = true; staticRoot.add(b);
  }
  box(staticRoot, .02, .02, .04, FRUIT.stem, cx - .44, .975, cz + .23, false);
  // and loose on the counter
  ball(.046, FRUIT.orange, cx + .1, .985, cz + .38);
  ball(.042, FRUIT.apple, cx + .2, .983, cz + .32); stem(cx + .2, 1.028, cz + .32);
}

function buildKitchen() {
  
  // Counter top with coffee machine
  {
    addObs(351.8, 994.4, 429.5, 1034.4); addTop(351.8, 994.4, 429.5, 1034.4, .96);
    const cx = wx(390.65), cz = wz(1014.4), w = 77.7 * S, d = 40 * S;
    box(staticRoot, w, .92, d, M.counter, cx, .46, cz);
    box(staticRoot, w + .04, .04, d + .04, M.deskTop, cx, .94, cz);
    box(staticRoot, .32, .4, .3, M.monitor, cx + .55, 1.16, cz - .3);
    box(staticRoot, .16, .02, .12, M.steel, cx + .73, 1.03, cz - .3, false);
    const led = new THREE.Mesh(boxGeo(.01, .03, .03), M.red); led.position.set(cx + .72, 1.28, cz - .26); staticRoot.add(led);
    cyl(staticRoot, .13, .13, .4, M.waterBottle, cx + .7, 1.17, cz + .35, 16);
    box(staticRoot, .4, .3, .3, M.steel, cx - .6, 1.11, cz - .25);
    for (let i = 0; i < 4; i++) cyl(staticRoot, .035, .03, .08, M.white, cx + .25, .99, cz - .2 + i * .1, 10, false);
    cyl(staticRoot, .14, .1, .08, M.diningWood2, cx - .1, .99, cz + .25, 14);
    fruit(cx, cz);
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

export { buildKitchen, updateBucket };
