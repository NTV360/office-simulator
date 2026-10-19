import { OX, OY, people, S, walkPxAt } from "@office/shared";
import * as THREE from "three";
import { stdMat } from "../character/gfx.js";
import { camera, scene } from "../render/renderer.js";
import { box, boxGeo, cyl } from "../world/helpers.js";
import { player } from "./player.js";

/* ================= Guns ================= */
// Four toy guns the player carries in first and third person, picked with 1-4 (control.js).
// Right click sights down the gun (zoom + crosshair), left click shoots: a projectile flies
// where the camera looks, and whoever it hits keels over for DOWN seconds with a burst of
// green splat (no gore: it is all green).
// A gun is a small group of primitives hung on the right hand, muzzle pointing +z at rest.
const DOWN = 2,
  RANGE = 16;

const glowCache = new Map();
const glowMat = (hex, i = 0.9) => {
  const k = hex + i;
  if (!glowCache.has(k))
    glowCache.set(
      k,
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: i,
        roughness: 0.4,
      }),
    );
  return glowCache.get(k);
};
const GRIP = stdMat("#4a3223", 0.8),
  WOOD = stdMat("#6b4a2f", 0.75),
  DARK = stdMat("#2e343a", 0.6);
const shinier = (hex) =>
  new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.3,
    metalness: 0.7,
  });
const STEEL_M = shinier("#8a939c"),
  BRASS_M = shinier("#b08d57"),
  COPPER = shinier("#b87333"),
  IRON = shinier("#3f464d");

function muzzleAt(g, z) {
  const m = new THREE.Object3D();
  m.position.set(0, 0.01, z);
  g.add(m);
  return m;
}
// 1. The Scrap-Coil: a junky receiver, copper coil rounds around the barrel, a battery box.
function scrapCoil() {
  const g = new THREE.Group();
  box(g, 0.07, 0.09, 0.2, IRON, 0, 0, 0.06);
  box(g, 0.05, 0.08, 0.08, WOOD, 0, -0.005, -0.07); // stock
  const grip = box(g, 0.045, 0.1, 0.055, GRIP, 0, -0.07, 0.02);
  grip.rotation.x = 0.25;
  const barrel = cyl(g, 0.012, 0.012, 0.16, STEEL_M, 0, 0.015, 0.26);
  barrel.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.026, 0.007, 6, 12),
      COPPER,
    );
    ring.position.set(0, 0.015, 0.21 + i * 0.04);
    g.add(ring);
  }
  box(g, 0.06, 0.05, 0.07, DARK, 0, -0.01, 0.13); // battery
  const led = new THREE.Mesh(boxGeo(0.014, 0.014, 0.014), glowMat("#7dd8ff"));
  led.position.set(0, 0.005, 0.165);
  g.add(led);
  return { group: g, muzzle: muzzleAt(g, 0.36) };
}
// 2. The Chrono-Bombard: brass body, side gear, wind-up key and a pressure gauge.
function chronoBombard() {
  const g = new THREE.Group();
  const body = cyl(g, 0.045, 0.05, 0.16, BRASS_M, 0, 0, 0.05);
  body.rotation.x = Math.PI / 2;
  const barrel = cyl(g, 0.026, 0.03, 0.2, COPPER, 0, 0.005, 0.24);
  barrel.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.033, 0.008, 8, 14),
    BRASS_M,
  );
  rim.position.set(0, 0.005, 0.335);
  g.add(rim);
  const gear = cyl(g, 0.05, 0.05, 0.014, BRASS_M, -0.055, 0.01, 0.06, 10);
  gear.rotation.z = Math.PI / 2;
  const gear2 = cyl(g, 0.036, 0.036, 0.016, COPPER, -0.052, -0.005, 0.12, 9);
  gear2.rotation.z = Math.PI / 2;
  box(g, 0.014, 0.05, 0.014, BRASS_M, 0, 0.075, 0.04); // key stem
  box(g, 0.07, 0.014, 0.014, BRASS_M, 0, 0.098, 0.04); // key bar
  const gauge = cyl(
    g,
    0.02,
    0.02,
    0.012,
    stdMat("#f4efe4", 0.3),
    0.05,
    0.035,
    0.1,
    12,
  );
  gauge.rotation.z = Math.PI / 2;
  const grip = box(g, 0.045, 0.1, 0.055, GRIP, 0, -0.07, 0.02);
  grip.rotation.x = 0.3;
  return { group: g, muzzle: muzzleAt(g, 0.4) };
}
// 3. The Magma-Squeezer: industrial pipes, a slung tank and glowing heat vents.
function magmaSqueezer() {
  const g = new THREE.Group();
  box(g, 0.09, 0.11, 0.18, IRON, 0, 0, 0.04);
  const barrel = cyl(g, 0.032, 0.036, 0.18, STEEL_M, 0, 0.02, 0.22);
  barrel.rotation.x = Math.PI / 2;
  const nozzle = cyl(g, 0.04, 0.032, 0.05, COPPER, 0, 0.02, 0.32);
  nozzle.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++)
    box(
      g,
      0.012,
      0.05,
      0.006,
      glowMat("#ff7a26"),
      0.046,
      -0.01 + i * 0.025,
      0.09,
      false,
    );
  cyl(g, 0.048, 0.048, 0.14, STEEL_M, 0, -0.075, 0.1); // underslung tank
  const cap = cyl(g, 0.02, 0.02, 0.03, DARK, 0, -0.075, 0.18);
  cap.rotation.x = Math.PI / 2;
  cyl(g, 0.014, 0.014, 0.04, stdMat("#c0392b", 0.5), 0, 0.075, 0.0); // valve stem
  box(g, 0.05, 0.012, 0.012, stdMat("#c0392b", 0.5), 0, 0.093, 0.0); // valve bar
  const grip = box(g, 0.05, 0.09, 0.06, GRIP, 0, -0.09, -0.01);
  grip.rotation.x = 0.25;
  return { group: g, muzzle: muzzleAt(g, 0.37) };
}
// 4. The Bioshocker: a lumpy organic shell with glowing green vials on top.
function bioshocker() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 12, 9),
    stdMat("#6e5638", 0.85),
  );
  body.scale.set(0.85, 0.95, 1.9);
  body.position.set(0, 0, 0.05);
  g.add(body);
  const lump = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    stdMat("#5d4930", 0.85),
  );
  lump.scale.set(0.9, 0.8, 1.1);
  lump.position.set(0, 0.01, -0.09);
  g.add(lump);
  const nozzle = cyl(
    g,
    0.024,
    0.034,
    0.13,
    stdMat("#d8cfc0", 0.55),
    0,
    0.005,
    0.24,
  );
  nozzle.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 8, 6),
    stdMat("#d8cfc0", 0.55),
  );
  tip.position.set(0, 0.005, 0.3);
  g.add(tip);
  for (const [x, z, tilt] of [
    [-0.03, 0.02, -0.5],
    [0.035, 0.06, 0.4],
  ]) {
    const vial = cyl(
      g,
      0.017,
      0.017,
      0.09,
      glowMat("#7ee83c", 0.7),
      x,
      0.085,
      z,
      8,
    );
    vial.rotation.x = Math.PI / 2 + tilt;
    const cap = cyl(
      g,
      0.019,
      0.019,
      0.018,
      DARK,
      x,
      0.085 + Math.sin(-tilt) * 0.045,
      z + Math.cos(tilt) * 0.045,
      8,
    );
    cap.rotation.x = Math.PI / 2 + tilt;
  }
  const sac = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 6),
    glowMat("#7ee83c", 0.5),
  );
  sac.scale.set(1, 0.8, 1.3);
  sac.position.set(0.06, 0.01, 0.12);
  g.add(sac);
  const grip = box(
    g,
    0.045,
    0.09,
    0.05,
    stdMat("#8a7a5c", 0.8),
    0,
    -0.085,
    0.0,
  );
  grip.rotation.x = 0.3;
  const knuckle = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    stdMat("#8a7a5c", 0.8),
  );
  knuckle.position.set(0, -0.12, 0.04);
  g.add(knuckle);
  return { group: g, muzzle: muzzleAt(g, 0.34) };
}

const GUNS = [
  {
    name: "Scrap-Coil",
    build: scrapCoil,
    cool: 0.26,
    proj: { kind: "bolt", color: 0x7dd8ff, size: 0.04, speed: 20, grav: 0 },
  },
  {
    name: "Chrono-Bombard",
    build: chronoBombard,
    cool: 0.5,
    proj: { kind: "ball", color: 0xc9a35c, size: 0.065, speed: 9.5, grav: 7 },
  },
  {
    name: "Magma-Squeezer",
    build: magmaSqueezer,
    cool: 0.34,
    proj: { kind: "fire", color: 0xff7a26, size: 0.055, speed: 13, grav: 2.5 },
  },
  {
    name: "Bioshocker",
    build: bioshocker,
    cool: 0.4,
    proj: { kind: "goo", color: 0x7ee83c, size: 0.07, speed: 11, grav: 4 },
  },
];

const GREEN = 0x39d353; // all the "blood" in this office
const shots = [],
  splats = [],
  stains = [];
let rig = null, // { body, guns: [{group, muzzle, rest}] } on the controlled person's right hand
  armed = false,
  aiming = false, // right button held: sight down the gun (zoom + crosshair)
  ads = 0, // 0..1 aim-down-sights blend
  savedFov = null,
  cross = null,
  cd = 0,
  tap = null,
  projGeo = null,
  splatGeo = null;

const _v = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _d = new THREE.Vector3();

const armedNow = () =>
  armed &&
  player.controlling &&
  player.person &&
  !player.sitting &&
  player.gun != null;

// The four guns ride the right hand of whoever you control; rebuilt when the body changes.
function syncGun() {
  const p = player.person,
    body = armed && p && player.controlling ? p.body : null;
  if (rig && rig.body !== body) {
    for (const g of rig.guns) g.group.removeFromParent();
    rig = null;
  }
  if (body && !rig) {
    const hand = body.sockets.rightHand.getWorldPosition(_v);
    rig = {
      body,
      guns: GUNS.map((def) => {
        const { group, muzzle } = def.build();
        group.position.copy(hand).add(_w.set(0, -0.07, 0.05)); // at the palm, a touch forward
        body.sockets.rightHand.attach(group);
        group.visible = false;
        return { group, muzzle, rest: group.position.clone() };
      }),
    };
  }
  if (rig)
    for (let i = 0; i < rig.guns.length; i++) {
      const gg = rig.guns[i],
        gr = gg.group;
      gr.visible = i === player.gun && armedNow();
      if (gr.visible) {
        gr.lookAt(aimPoint(_c)); // barrel (+z) points where the crosshair does
        if (ads > 0.01 && player.person) {
          // shouldered: float the gun up to cheek height, a little ahead of the face
          _b.copy(player.person.pos);
          _b.y += 1.42;
          _d.copy(_w);
          _d.y = 0;
          if (_d.lengthSq() > 1e-6) _d.normalize();
          _b.addScaledVector(_d, 0.34);
          const hand = rig.body.sockets.rightHand;
          hand.updateWorldMatrix(true, false);
          hand.worldToLocal(_b);
          gr.position.lerpVectors(gg.rest, _b, ads);
        } else gr.position.copy(gg.rest);
      }
    }
}
function gunsShow(on) {
  armed = on;
  if (!on) aiming = false;
}
function selectGun(i) {
  if (i >= 0 && i < GUNS.length) player.gun = i;
  syncGun();
}

function spawnShot(def, from, dir) {
  projGeo ??= new THREE.SphereGeometry(1, 10, 8);
  const m = new THREE.Mesh(
    projGeo,
    glowMat(def.color === 0xc9a35c ? "#c9a35c" : "#" + def.color.toString(16)),
  );
  m.scale.setScalar(def.size);
  if (def.kind === "ball") {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.35, 6, 12),
      COPPER,
    );
    m.add(ring); // a clockwork bomb: brass ball with a ring
  }
  m.position.copy(from).addScaledVector(dir, 0.08);
  scene.add(m);
  shots.push({
    m,
    vx: dir.x * def.speed,
    vy: dir.y * def.speed,
    vz: dir.z * def.speed,
    grav: def.grav,
    kind: def.kind,
    size: def.size,
    life: RANGE / def.speed,
  });
}
// The world point the crosshair sits on: the closest person within a cone of the camera
// ray, else a spot downrange. Gun barrels look at it and shots converge on it.
function aimPoint(out) {
  camera.getWorldPosition(_a);
  camera.getWorldDirection(_w);
  let bd = RANGE * 0.6;
  for (const q of people) {
    if (q === player.person || q.state === "away") continue;
    _b.set(q.pos.x - _a.x, q.pos.y + 1.0 - _a.y, q.pos.z - _a.z);
    const t = _b.dot(_w);
    if (t < 0.4 || t > bd) continue;
    const px = _a.x + _w.x * t - q.pos.x,
      pz = _a.z + _w.z * t - q.pos.z;
    if (Math.hypot(px, pz) < 0.5) bd = t;
  }
  return out.copy(_a).addScaledVector(_w, bd);
}
function aimDir(from) {
  aimPoint(_c);
  return _w.set(_c.x - from.x, _c.y - from.y, _c.z - from.z).normalize();
}
function fire() {
  if (!armedNow() || cd > 0 || !rig) return;
  const def = GUNS[player.gun],
    g = rig.guns[player.gun];
  cd = def.cool;
  g.muzzle.getWorldPosition(_v);
  spawnShot(def.proj, _v, aimDir(_v));
}
// Right click sights down the gun; left click shoots. Pointer-locked (first person) fires on
// press; otherwise a quick tap on release so a look-drag does not fire.
function gunDown(e) {
  if (e.button === 2) {
    aiming = armedNow();
    return;
  }
  if (!armedNow() || e.button !== 0) return;
  if (document.pointerLockElement) fire();
  else tap = { x: e.clientX, y: e.clientY, t: performance.now() };
}
function gunUp(e) {
  if (e.button === 2) {
    aiming = false;
    return;
  }
  if (!tap || e.button !== 0) {
    tap = null;
    return;
  }
  const { x, y, t } = tap;
  tap = null;
  if (
    armedNow() &&
    performance.now() - t < 260 &&
    Math.hypot(e.clientX - x, e.clientY - y) < 8
  )
    fire();
}

// Green splat: a burst of droplets plus a little pool that fades while they are down.
function splat(x, y, z, big = false) {
  splatGeo ??= new THREE.SphereGeometry(1, 6, 5);
  const n = big ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(splatGeo, glowMat("#39d353", 0.4));
    m.scale.setScalar(0.015 + Math.random() * 0.03);
    m.position.set(x, y, z);
    scene.add(m);
    splats.push({
      m,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 0.8 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 2.4,
      life: 0.55 + Math.random() * 0.3,
    });
  }
}
function stain(x, z) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 14),
    new THREE.MeshBasicMaterial({
      color: GREEN,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  scene.add(m);
  stains.push({ m, life: DOWN + 0.3 });
}
function knock(p) {
  p.down = DOWN;
  p.dizzy = false;
  stain(p.pos.x, p.pos.z);
  splat(p.pos.x, 0.9, p.pos.z, true);
}

const hitY = (q, y) => y > q.pos.y && y < q.pos.y + 1.55;
// Screen-centre crosshair, built on first aim: a small green plus with a dark outline.
function crosshair() {
  if (cross) return cross;
  cross = document.createElement("div");
  cross.id = "gunCross";
  cross.style.cssText =
    "position:fixed;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);pointer-events:none;z-index:80;display:none";
  for (const [l, t, w, h] of [
    [8, 0, 2, 6],
    [8, 12, 2, 6],
    [0, 8, 6, 2],
    [12, 8, 6, 2],
  ]) {
    const bar = document.createElement("div");
    bar.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:#b6ffce;box-shadow:0 0 3px #000`;
    cross.appendChild(bar);
  }
  document.body.appendChild(cross);
  return cross;
}
function updateGuns(dt) {
  if (cd > 0) cd -= dt;
  // Aim-down-sights: ease in a zoom and raise the crosshair while the right button is held.
  if (!armed) {
    aiming = false;
    ads = 0;
    savedFov = null; // a leaving mode owns the fov again
  }
  const wantAds = aiming && armedNow() ? 1 : 0;
  if (wantAds && savedFov == null) savedFov = camera.fov;
  ads += (wantAds - ads) * Math.min(1, dt * 14);
  if (savedFov != null) {
    camera.fov = savedFov * (1 - 0.42 * ads);
    camera.updateProjectionMatrix();
    if (ads < 0.002 && !wantAds) {
      camera.fov = savedFov;
      camera.updateProjectionMatrix();
      savedFov = null;
    }
  }
  if (cross || wantAds)
    crosshair().style.display = ads > 0.3 ? "block" : "none";
  syncGun();
  for (const p of people) if (p.down > 0) p.down = Math.max(0, p.down - dt);
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.vy -= s.grav * dt;
    s.m.position.x += s.vx * dt;
    s.m.position.y += s.vy * dt;
    s.m.position.z += s.vz * dt;
    s.life -= dt;
    if (s.kind === "bolt")
      s.m.scale.setScalar(s.size * (0.7 + Math.random() * 0.8)); // crackling
    else if (s.kind === "fire")
      s.m.scale.setScalar(s.size * (0.9 + Math.sin(s.life * 40) * 0.25));
    const { x, y, z } = s.m.position;
    let dead = s.life <= 0;
    if (!dead && y <= 0.01) {
      splat(x, 0.03, z);
      dead = true;
    }
    if (!dead && !walkPxAt(x / S + OX, z / S + OY, y)) {
      splat(x, y, z); // smacked into a wall or tall furniture
      dead = true;
    }
    if (!dead)
      for (const q of people) {
        if (q === player.person || q.state === "away") continue;
        if (hitY(q, y) && Math.hypot(x - q.pos.x, z - q.pos.z) < 0.3) {
          knock(q);
          dead = true;
          break;
        }
      }
    if (dead) {
      scene.remove(s.m);
      shots.splice(i, 1);
    }
  }
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    s.vy -= 7 * dt;
    s.m.position.x += s.vx * dt;
    s.m.position.y = Math.max(0.01, s.m.position.y + s.vy * dt);
    s.m.position.z += s.vz * dt;
    s.life -= dt;
    if (s.life < 0.2)
      s.m.scale.multiplyScalar(Math.max(0, (s.life / 0.2) * 1.05));
    if (s.life <= 0) {
      scene.remove(s.m);
      splats.splice(i, 1);
    }
  }
  for (let i = stains.length - 1; i >= 0; i--) {
    const s = stains[i];
    s.life -= dt;
    s.m.material.opacity = Math.min(0.7, s.life);
    if (s.life <= 0) {
      scene.remove(s.m);
      s.m.material.dispose();
      stains.splice(i, 1);
    }
  }
}

export { fire, gunDown, GUNS, gunsShow, gunUp, selectGun, updateGuns };
