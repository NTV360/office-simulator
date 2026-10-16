import * as THREE from 'three';
import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { makeBucket } from '../../character/props.js';
import { SO, WST, mkSpot } from './basics.js';
import { addObs, addTop, box, boxGeo, cyl, dynamic, staticRoot } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

// The toilet bucket by the counter. `mesh` is the one on the floor: it is hidden while somebody has it out (see updateBucket).
const BUCKET = { mesh: null };


// Doors that open while someone grabs a snack: { hinge, leaf, open, spot } (see updateKitchen).
const KITCHEN = { doors: [], spots: [] };
const mats = new Map(); // one material per look, so the baked food costs a few draw calls, not one per piece
const food = (color, roughness, extra = {}) => { const k = `${color}/${roughness}/${JSON.stringify(extra)}`; if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness, ...extra })); return mats.get(k); };
const decor = m => { m.userData.decor = true; return m; };

// A door hinged on a vertical edge at (hx, front). `dir` 1: the leaf extends to +x from the hinge; -1: to -x.
// It swings out into the room (toward -z). The hinge group is dynamic so it is not merged by the bake.
function door(hx, front, w, h, y, dir, mat) {
  const hinge = dynamic(new THREE.Group()); hinge.position.set(hx, y, front); staticRoot.add(hinge);
  const leaf = new THREE.Group(); hinge.add(leaf);
  const panel = dynamic(new THREE.Mesh(boxGeo(w, h, .025), mat)); panel.position.set(dir * w / 2, 0, -.013); panel.castShadow = true; leaf.add(panel);
  const knob = dynamic(new THREE.Mesh(boxGeo(.02, .12, .03), M.steel)); knob.position.set(dir * (w - .06), -.05, -.04); leaf.add(knob);
  return { hinge, leaf, dir, angle: 0 };
}
// Snacks on the cabinet's two shelves: chip bags, cup noodles and biscuit boxes.
function snacksIn(cx, bottom, shelf, cz, span) {
  const colors = [0xd64545, 0xf2b43c, 0x3fae6c, 0x4f86d9, 0xee7fb0, 0xe86f3a];
  for (const y0 of [bottom, shelf]) {
    let x = cx - span / 2 + .05, i = Math.floor(y0 * 10);
    while (x < cx + span / 2 - .06) {
      const kind = i % 3, c = colors[i % colors.length];
      if (kind === 0) { const m = decor(new THREE.Mesh(boxGeo(.1, .16, .05), food(c, .4))); m.position.set(x, y0 + .08, cz); staticRoot.add(m); x += .12; }
      else if (kind === 1) { decor(cyl(staticRoot, .04, .035, .09, food(0xf4f3ef, .6), x, y0 + .045, cz + .02, 12, false)); x += .1; }
      else { const m = decor(new THREE.Mesh(boxGeo(.08, .2, .1), food(c, .7))); m.position.set(x, y0 + .1, cz - .02); staticRoot.add(m); x += .11; }
      i++;
    }
  }
}
// Fridge shelves: bottles, cans, a milk carton, fruit and a cake box.
function fridgeFood(cx, cz, span) {
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0xdfeef5, transparent: true, opacity: .6, roughness: .2 });
  [.45, .85, 1.25].forEach(y => box(staticRoot, span, .015, .6, shelfMat, cx, y, cz, false));
  const bottle = [0x4fb4e0, 0x3fae6c, 0xe8875b], can = [0xd64545, 0x2f6fd6, 0xc0c6cc];
  for (let i = 0; i < 4; i++) decor(cyl(staticRoot, .04, .04, .26, food(bottle[i % 3], .15, { transparent: true, opacity: .85 }), cx - span / 2 + .1 + i * .17, 1.39, cz - .05, 12, false));
  for (let i = 0; i < 5; i++) decor(cyl(staticRoot, .032, .032, .12, food(can[i % 3], .3, { metalness: .5 }), cx - span / 2 + .08 + i * .13, .92, cz - .1, 12, false));
  decor(box(staticRoot, .1, .22, .1, food(0xf4f3ef, .6), cx - .2, .57, cz - .05));   // milk carton
  decor(box(staticRoot, .2, .1, .16, food(0xee7fb0, .6), cx + .1, .51, cz - .05));   // cake box
  [[-.25, 0xc8302c], [-.15, 0xf08a1c], [-.05, 0x7fb03a]].forEach(([dx, c]) => { const f = decor(new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), food(c, .5))); f.position.set(cx + dx + .3, .09 + .035 + .06, cz - .1); staticRoot.add(f); });
}

// Per frame: the cabinet or fridge door swings open while someone at it is grabbing a snack, then closes.
function updateKitchen(dt) {
  const k = 1 - Math.exp(-dt * 6);
  KITCHEN.doors.forEach((d, i) => {
    const p = (i < 2 ? KITCHEN.spots[0] : KITCHEN.spots[1])?.occupant;
    const target = p && p.state === 'doing' && p.task?.kind === 'snack' ? 1.75 : 0;
    d.angle += (target - d.angle) * k;
    d.hinge.rotation.y = d.dir * d.angle;
  });
}

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
  // Snack cabinet on the wall above the sink: open-fronted box with a shelf of snacks, closed by two hinged
  // doors that swing open while someone grabs a snack (updateKitchen)
  {
    const cx = wx(392), cz = wz(1083.3) - .2, w = 1.3, h = .62, d = .36, y = 1.78, front = cz - d / 2;
    box(staticRoot, w, h, .02, M.sinkCab, cx, y, cz + d / 2 - .01);                 // back
    [-1, 1].forEach(s => box(staticRoot, .02, h, d, M.sinkCab, cx + s * (w / 2 - .01), y, cz)); // sides
    [y - h / 2 + .01, y + h / 2 - .01, y].forEach(yy => box(staticRoot, w - .04, .02, d - .02, M.sinkCab, cx, yy, cz, false)); // bottom, top, shelf
    snacksIn(cx, y - h / 2 + .02, y + .01, cz, w - .1);
    KITCHEN.doors.push(door(cx - w / 2, front, w / 2 - .01, h - .02, y, 1, M.deskTop), door(cx + w / 2, front, w / 2 - .01, h - .02, y, -1, M.deskTop));
    KITCHEN.spots.push(mkSpot('snack', 391, 1049, SO, { place: 'the snack cabinet' }));
  }
  // The fridge, between the sink and the lockers, against the wall: lit shelves of drinks and food, one door
  {
    const cx = wx(452), cz = wz(1101), w = .8, h = 1.85, d = .75, front = cz - d / 2;
    addObs(441.5, 1092, 462.5, 1110.6);
    box(staticRoot, w, h, .03, M.fridge, cx, h / 2, cz + d / 2 - .015);
    [-1, 1].forEach(s => box(staticRoot, .03, h, d, M.fridge, cx + s * (w / 2 - .015), h / 2, cz));
    box(staticRoot, w, .03, d, M.fridge, cx, h - .015, cz); box(staticRoot, w, .1, d, M.fridge, cx, .05, cz);
    box(staticRoot, w - .08, h - .2, .01, M.fridgeIn, cx, h / 2 + .03, cz + d / 2 - .035, false); // lit inner back
    fridgeFood(cx, cz, w - .1);
    const fd = door(cx + w / 2, front, w - .01, h - .12, h / 2 + .03, -1, M.fridge);
    dynamic(box(fd.leaf, .03, .5, .04, M.steel, -(w - .01) + .07, .12, -.04, false)); // handle (it swings with the door)
    KITCHEN.doors.push(fd);
    KITCHEN.spots.push(mkSpot('snack', 452, 1079, SO, { place: 'the fridge' }));
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

export { buildKitchen, drawApple, drawBananas, drawCoffeeMachine, drawFruitBowl, drawOrange, updateBucket, updateKitchen };
