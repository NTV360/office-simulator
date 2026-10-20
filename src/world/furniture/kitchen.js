import * as THREE from "three";
import { makeBucket } from "../../character/props.js";
import { S, wx, wz } from "../../config/plan.js";
import { M } from "../../render/materials.js";
import { addObs, box, boxGeo, cyl, dynamic, staticRoot } from "../helpers.js";
import { SO, WST, mkSpot } from "./basics.js";

// The toilet bucket by the counter. `mesh` is the one on the floor (hidden while someone has it out),
// `carrier` who has it. See the bucket run in sim/tasks.js.
const BUCKET = { mesh: null, carrier: null };

// Doors that open while someone grabs a snack: { hinge, leaf, open, spot } (see updateKitchen).
const KITCHEN = { doors: [], spots: [] };

// A door hinged on a vertical edge at (hx, front). `dir` 1: the leaf extends to +x from the hinge; -1: to -x.
// It swings out into the room (toward -z). The hinge group is dynamic so it is not merged by the bake.
function door(hx, front, w, h, y, dir, mat) {
  const hinge = dynamic(new THREE.Group());
  hinge.position.set(hx, y, front);
  staticRoot.add(hinge);
  const leaf = new THREE.Group();
  hinge.add(leaf);
  const panel = dynamic(new THREE.Mesh(boxGeo(w, h, 0.025), mat));
  panel.position.set((dir * w) / 2, 0, -0.013);
  panel.castShadow = true;
  leaf.add(panel);
  const knob = dynamic(new THREE.Mesh(boxGeo(0.02, 0.12, 0.03), M.steel));
  knob.position.set(dir * (w - 0.06), -0.05, -0.04);
  leaf.add(knob);
  return { hinge, leaf, dir, angle: 0 };
}
// Snacks on the cabinet's two shelves: chip bags, cup noodles and biscuit boxes.
function snacksIn(cx, bottom, shelf, cz, span) {
  const colors = [0xd64545, 0xf2b43c, 0x3fae6c, 0x4f86d9, 0xee7fb0, 0xe86f3a];
  for (const y0 of [bottom, shelf]) {
    let x = cx - span / 2 + 0.05,
      i = Math.floor(y0 * 10);
    while (x < cx + span / 2 - 0.06) {
      const kind = i % 3,
        c = colors[i % colors.length];
      if (kind === 0) {
        const m = new THREE.Mesh(
          boxGeo(0.1, 0.16, 0.05),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }),
        );
        m.position.set(x, y0 + 0.08, cz);
        staticRoot.add(m);
        x += 0.12;
      } else if (kind === 1) {
        cyl(
          staticRoot,
          0.04,
          0.035,
          0.09,
          new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.6 }),
          x,
          y0 + 0.045,
          cz + 0.02,
          12,
          false,
        );
        x += 0.1;
      } else {
        const m = new THREE.Mesh(
          boxGeo(0.08, 0.2, 0.1),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }),
        );
        m.position.set(x, y0 + 0.1, cz - 0.02);
        staticRoot.add(m);
        x += 0.11;
      }
      i++;
    }
  }
}
// Fridge shelves: bottles, cans, a milk carton, fruit and a cake box.
function fridgeFood(cx, cz, span) {
  const shelfMat = new THREE.MeshStandardMaterial({
    color: 0xdfeef5,
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
  });
  [0.45, 0.85, 1.25].forEach((y) =>
    box(staticRoot, span, 0.015, 0.6, shelfMat, cx, y, cz, false),
  );
  const bottle = [0x4fb4e0, 0x3fae6c, 0xe8875b],
    can = [0xd64545, 0x2f6fd6, 0xc0c6cc];
  for (let i = 0; i < 4; i++)
    cyl(
      staticRoot,
      0.04,
      0.04,
      0.26,
      new THREE.MeshStandardMaterial({
        color: bottle[i % 3],
        transparent: true,
        opacity: 0.85,
        roughness: 0.15,
      }),
      cx - span / 2 + 0.1 + i * 0.17,
      1.39,
      cz - 0.05,
      12,
      false,
    );
  for (let i = 0; i < 5; i++)
    cyl(
      staticRoot,
      0.032,
      0.032,
      0.12,
      new THREE.MeshStandardMaterial({
        color: can[i % 3],
        roughness: 0.3,
        metalness: 0.5,
      }),
      cx - span / 2 + 0.08 + i * 0.13,
      0.92,
      cz - 0.1,
      12,
      false,
    );
  box(
    staticRoot,
    0.1,
    0.22,
    0.1,
    new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.6 }),
    cx - 0.2,
    0.57,
    cz - 0.05,
  ); // milk carton
  box(
    staticRoot,
    0.2,
    0.1,
    0.16,
    new THREE.MeshStandardMaterial({ color: 0xee7fb0, roughness: 0.6 }),
    cx + 0.1,
    0.51,
    cz - 0.05,
  ); // cake box
  [
    [-0.25, 0xc8302c],
    [-0.15, 0xf08a1c],
    [-0.05, 0x7fb03a],
  ].forEach(([dx, c]) => {
    const f = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 8),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }),
    );
    f.position.set(cx + dx + 0.3, 0.09 + 0.035 + 0.06, cz - 0.1);
    staticRoot.add(f);
  });
}

// Per frame: the cabinet or fridge door swings open while someone at it is grabbing a snack, then closes.
function updateKitchen(dt) {
  const k = 1 - Math.exp(-dt * 6);
  KITCHEN.doors.forEach((d, i) => {
    const p = (i < 2 ? KITCHEN.spots[0] : KITCHEN.spots[1])?.occupant;
    const target =
      p && p.state === "doing" && p.task?.kind === "snack" ? 1.75 : 0;
    d.angle += (target - d.angle) * k;
    d.hinge.rotation.y = d.dir * d.angle;
  });
}

// Fruit on the counter: apples and an orange in the bowl, a bunch of bananas and a couple more beside it.
const FRUIT = {
  apple: new THREE.MeshStandardMaterial({ color: 0xc8302c, roughness: 0.45 }),
  apple2: new THREE.MeshStandardMaterial({ color: 0x7fb03a, roughness: 0.45 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xf08a1c, roughness: 0.7 }),
  banana: new THREE.MeshStandardMaterial({ color: 0xf2cf4a, roughness: 0.6 }),
  stem: new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.8 }),
};
function fruit(cx, cz) {
  const ball = (r, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    staticRoot.add(m);
    return m;
  };
  const stem = (x, y, z) =>
    box(staticRoot, 0.008, 0.025, 0.008, FRUIT.stem, x, y, z, false);
  // in the bowl (centre cx - .1, cz + .25, rim at about 1.03)
  [
    [-0.15, 0.21, FRUIT.apple],
    [-0.05, 0.22, FRUIT.apple2],
    [-0.1, 0.31, FRUIT.apple],
  ].forEach(([dx, dz, mat]) => {
    ball(0.042, mat, cx + dx, 1.05, cz + dz);
    stem(cx + dx, 1.095, cz + dz);
  });
  ball(0.046, FRUIT.orange, cx - 0.09, 1.1, cz + 0.26);
  // a bunch of bananas: curved fingers joined at the stem
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.016, 6, 14, 1.6),
      FRUIT.banana,
    );
    b.rotation.set(Math.PI / 2, 0, -0.8 + i * 0.14);
    b.position.set(cx - 0.48 + i * 0.012, 0.965 + i * 0.008, cz + 0.3);
    b.castShadow = true;
    staticRoot.add(b);
  }
  box(
    staticRoot,
    0.02,
    0.02,
    0.04,
    FRUIT.stem,
    cx - 0.44,
    0.975,
    cz + 0.23,
    false,
  );
  // and loose on the counter
  ball(0.046, FRUIT.orange, cx + 0.1, 0.985, cz + 0.38);
  ball(0.042, FRUIT.apple, cx + 0.2, 0.983, cz + 0.32);
  stem(cx + 0.2, 1.028, cz + 0.32);
}

function buildKitchen() {
  // Counter top with coffee machine
  {
    addObs(351.8, 994.4, 429.5, 1034.4, 0.94);
    const cx = wx(390.65),
      cz = wz(1014.4),
      w = 77.7 * S,
      d = 40 * S;
    box(staticRoot, w, 0.92, d, M.counter, cx, 0.46, cz);
    box(staticRoot, w + 0.04, 0.04, d + 0.04, M.deskTop, cx, 0.94, cz);
    box(staticRoot, 0.32, 0.4, 0.3, M.monitor, cx + 0.55, 1.16, cz - 0.3);
    box(
      staticRoot,
      0.16,
      0.02,
      0.12,
      M.steel,
      cx + 0.73,
      1.03,
      cz - 0.3,
      false,
    );
    const led = new THREE.Mesh(boxGeo(0.01, 0.03, 0.03), M.red);
    led.position.set(cx + 0.72, 1.28, cz - 0.26);
    staticRoot.add(led);
    cyl(
      staticRoot,
      0.13,
      0.13,
      0.4,
      M.waterBottle,
      cx + 0.7,
      1.17,
      cz + 0.35,
      16,
    );
    box(staticRoot, 0.4, 0.3, 0.3, M.steel, cx - 0.6, 1.11, cz - 0.25);
    for (let i = 0; i < 4; i++)
      cyl(
        staticRoot,
        0.035,
        0.03,
        0.08,
        M.white,
        cx + 0.25,
        0.99,
        cz - 0.2 + i * 0.1,
        10,
        false,
      );
    cyl(
      staticRoot,
      0.14,
      0.1,
      0.08,
      M.diningWood2,
      cx - 0.1,
      0.99,
      cz + 0.25,
      14,
    );
    fruit(cx, cz);
    mkSpot("counter", 442, 1004, WST, { place: "the counter" });
    mkSpot("counter", 442, 1024, WST, { place: "the counter" });
  }
  // Sink
  {
    addObs(351.8, 1061.1, 437.3, 1083.3, 0.9);
    const cx = wx(394.55),
      cz = wz(1072.2),
      w = 85.5 * S,
      d = 22.2 * S;
    box(staticRoot, w, 0.88, d, M.sinkCab, cx, 0.44, cz);
    box(staticRoot, w + 0.02, 0.04, d + 0.02, M.deskTop, cx, 0.9, cz);
    box(staticRoot, 0.55, 0.03, 0.4, M.steel, wx(370.3), 0.925, cz, false);
    cyl(staticRoot, 0.02, 0.02, 0.3, M.steel, wx(370.3), 1.07, cz + 0.26, 8);
    box(staticRoot, 0.03, 0.03, 0.16, M.steel, wx(370.3), 1.21, cz + 0.19);
    mkSpot("sink", 374, 1049, SO, { place: "the sink" });
    mkSpot("sink", 408, 1049, SO, { place: "the sink" });
  }
  // Snack cabinet on the wall above the sink: open-fronted box with a shelf of snacks, closed by two hinged
  // doors that swing open while someone grabs a snack (updateKitchen)
  {
    const cx = wx(392),
      cz = wz(1083.3) - 0.2,
      w = 1.3,
      h = 0.62,
      d = 0.36,
      y = 1.78,
      front = cz - d / 2;
    box(staticRoot, w, h, 0.02, M.sinkCab, cx, y, cz + d / 2 - 0.01); // back
    [-1, 1].forEach((s) =>
      box(staticRoot, 0.02, h, d, M.sinkCab, cx + s * (w / 2 - 0.01), y, cz),
    ); // sides
    [y - h / 2 + 0.01, y + h / 2 - 0.01, y].forEach((yy) =>
      box(staticRoot, w - 0.04, 0.02, d - 0.02, M.sinkCab, cx, yy, cz, false),
    ); // bottom, top, shelf
    snacksIn(cx, y - h / 2 + 0.02, y + 0.01, cz, w - 0.1);
    KITCHEN.doors.push(
      door(cx - w / 2, front, w / 2 - 0.01, h - 0.02, y, 1, M.deskTop),
      door(cx + w / 2, front, w / 2 - 0.01, h - 0.02, y, -1, M.deskTop),
    );
    KITCHEN.spots.push(
      mkSpot("snack", 391, 1049, SO, { place: "the snack cabinet" }),
    );
  }
  // The fridge, between the sink and the lockers, against the wall: lit shelves of drinks and food, one door
  {
    const cx = wx(452),
      cz = wz(1101),
      w = 0.8,
      h = 1.85,
      d = 0.75,
      front = cz - d / 2;
    addObs(441.5, 1092, 462.5, 1110.6);
    box(staticRoot, w, h, 0.03, M.fridge, cx, h / 2, cz + d / 2 - 0.015);
    [-1, 1].forEach((s) =>
      box(
        staticRoot,
        0.03,
        h,
        d,
        M.fridge,
        cx + s * (w / 2 - 0.015),
        h / 2,
        cz,
      ),
    );
    box(staticRoot, w, 0.03, d, M.fridge, cx, h - 0.015, cz);
    box(staticRoot, w, 0.1, d, M.fridge, cx, 0.05, cz);
    box(
      staticRoot,
      w - 0.08,
      h - 0.2,
      0.01,
      M.fridgeIn,
      cx,
      h / 2 + 0.03,
      cz + d / 2 - 0.035,
      false,
    ); // lit inner back
    fridgeFood(cx, cz, w - 0.1);
    const fd = door(
      cx + w / 2,
      front,
      w - 0.01,
      h - 0.12,
      h / 2 + 0.03,
      -1,
      M.fridge,
    );
    box(
      fd.leaf,
      0.03,
      0.5,
      0.04,
      M.steel,
      -(w - 0.01) + 0.07,
      0.12,
      -0.04,
      false,
    ); // handle
    KITCHEN.doors.push(fd);
    KITCHEN.spots.push(mkSpot("snack", 452, 1079, SO, { place: "the fridge" }));
  }
  // The green bucket on the floor at the counter's corner by the wall, with a spot to grab it from
  {
    const b = makeBucket();
    b.position.set(wx(358), 0, wz(986));
    b.traverse((o) => dynamic(o));
    staticRoot.add(b);
    BUCKET.mesh = b;
    mkSpot("bucket", 368, 986, WST, { place: "the bucket" });
  }
}

export { BUCKET, buildKitchen, updateKitchen };
