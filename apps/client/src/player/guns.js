import { OX, OY, people, S, walkPxAt } from "@office/shared";
import * as THREE from "three";
import { keys } from "../camera/input.js";
import { stdMat } from "../character/gfx.js";
import { camera, scene } from "../render/renderer.js";
import { $ } from "../ui/dom.js";
import { box, boxGeo, cyl } from "../world/helpers.js";
import { ctl } from "./control.js";
import { player } from "./player.js";

/* ================= Guns & FPS Viewmodel System ================= */
// Four over-the-top office blasters carried in first and third person, picked with 1-4 or mouse wheel.
// In First Person (fp), the active blaster mounts to an FPS camera viewmodel with two-handed grip,
// mouse-look sway, figure-8 walk/sprint bob, jump/land inertia, equip animations, recoil kickback,
// and true iron-sight / holographic ADS alignment on right-click.
// In Third Person (tp), the blaster rides the character's right hand in a two-handed combat stance.
const DOWN = 2,
  MAX_HP = 100,
  REGEN_DELAY = 3.2,
  REGEN_RATE = 28,
  RANGE = 18;

const glowCache = new Map();
const glowMat = (hex, i = 0.9) => {
  const k = hex + "_" + i;
  if (!glowCache.has(k))
    glowCache.set(
      k,
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: i,
        roughness: 0.3,
      }),
    );
  return glowCache.get(k);
};

const GRIP = stdMat("#2b2623", 0.82),
  WOOD = stdMat("#5c3a21", 0.72),
  WALNUT = stdMat("#422815", 0.76),
  DARK = stdMat("#1f2429", 0.55),
  POLYMER = stdMat("#282e36", 0.62),
  HAZARD = stdMat("#e6a117", 0.5),
  BONE = stdMat("#d8cfc0", 0.52),
  CHITIN = stdMat("#3a2d4c", 0.65),
  CHITIN_HI = stdMat("#523f6b", 0.55);

const shinier = (hex, rough = 0.26, metal = 0.78) =>
  new THREE.MeshStandardMaterial({
    color: hex,
    roughness: rough,
    metalness: metal,
  });

const STEEL_M = shinier("#96a1ab", 0.24, 0.82),
  TITANIUM = shinier("#5c6670", 0.3, 0.75),
  BRASS_M = shinier("#cfa34e", 0.24, 0.85),
  COPPER = shinier("#c87533", 0.26, 0.82),
  IRON = shinier("#343b42", 0.35, 0.72),
  GOLD_M = shinier("#f2c94c", 0.2, 0.9);

const LENS_CYAN = new THREE.MeshBasicMaterial({
  color: 0x7dd8ff,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const LENS_GREEN = new THREE.MeshBasicMaterial({
  color: 0x7ee83c,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function muzzleAt(g, z, y = 0.02) {
  const m = new THREE.Object3D();
  m.position.set(0, y, z);
  g.add(m);
  return m;
}

// Build stylized first-person hands & forearm sleeves that grip the weapon in FP mode.
function buildFpHands(g, foreZ = 0.16, foreY = -0.04) {
  const hands = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({
    color: "#e8b59a",
    roughness: 0.65,
  });
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: "#3e6e9c",
    roughness: 0.75,
  });
  const cuffMat = stdMat("#e9ecef", 0.7);

  // Right hand on the main pistol grip + forearm going back-right toward camera shoulder
  const rPalm = box(
    hands,
    0.052,
    0.068,
    0.058,
    skinMat,
    -0.008,
    -0.062,
    0.008,
    false,
  );
  rPalm.rotation.x = 0.28;
  const rFingers = box(
    hands,
    0.054,
    0.052,
    0.036,
    skinMat,
    0.006,
    -0.062,
    0.038,
    false,
  );
  rFingers.rotation.x = 0.25;
  const rThumb = box(
    hands,
    0.022,
    0.024,
    0.048,
    skinMat,
    0.024,
    -0.035,
    0.022,
    false,
  );
  rThumb.rotation.set(0.15, -0.35, 0);
  const rCuff = cyl(
    hands,
    0.036,
    0.039,
    0.035,
    cuffMat,
    -0.032,
    -0.1,
    -0.045,
    10,
    false,
  );
  rCuff.rotation.set(1.18, 0, -0.32);
  const rArm = cyl(
    hands,
    0.038,
    0.046,
    0.24,
    sleeveMat,
    -0.072,
    -0.165,
    -0.15,
    10,
    false,
  );
  rArm.rotation.set(1.18, 0, -0.32);

  // Left support hand cradling the foregrip / barrel shroud + forearm going back-left
  const lPalm = box(
    hands,
    0.054,
    0.048,
    0.068,
    skinMat,
    0.018,
    foreY - 0.012,
    foreZ,
    false,
  );
  lPalm.rotation.set(0.1, -0.2, -0.35);
  const lThumb = box(
    hands,
    0.022,
    0.036,
    0.048,
    skinMat,
    0.034,
    foreY + 0.014,
    foreZ - 0.005,
    false,
  );
  lThumb.rotation.set(0.2, 0, 0.45);
  const lCuff = cyl(
    hands,
    0.036,
    0.039,
    0.035,
    cuffMat,
    0.068,
    foreY - 0.055,
    foreZ - 0.07,
    10,
    false,
  );
  lCuff.rotation.set(1.08, 0, 0.52);
  const lArm = cyl(
    hands,
    0.038,
    0.046,
    0.26,
    sleeveMat,
    0.135,
    foreY - 0.125,
    foreZ - 0.175,
    10,
    false,
  );
  lArm.rotation.set(1.08, 0, 0.52);

  hands.userData = { skinMat, sleeveMat };
  g.add(hands);
  return hands;
}

// 1. The Scrap-Coil: Twin-rail plasma coilgun with holographic reflex sight, glowing core & spinning induction rings.
function scrapCoil() {
  const g = new THREE.Group();
  const cyanHi = glowMat("#7dd8ff", 1.25),
    cyanSoft = glowMat("#38bdf8", 0.85);

  // Skeletonized tactical stock & buffer tube
  box(g, 0.044, 0.078, 0.11, POLYMER, 0, -0.008, -0.085);
  box(g, 0.048, 0.095, 0.024, DARK, 0, -0.015, -0.14); // rubber buttpad
  box(g, 0.05, 0.022, 0.09, TITANIUM, 0, 0.028, -0.075); // cheek rest

  // Upper & lower receiver with plasma core window
  box(g, 0.074, 0.088, 0.21, IRON, 0, 0.006, 0.065);
  box(g, 0.082, 0.038, 0.16, TITANIUM, 0, 0.024, 0.065);
  // Glowing cyan plasma chamber core visible from both sides
  const core = cyl(g, 0.022, 0.022, 0.13, cyanHi, 0, 0.018, 0.075, 12, false);
  core.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    box(g, 0.086, 0.018, 0.012, DARK, 0, 0.018, 0.025 + i * 0.032);
  }

  // Ergonomic pistol grip + trigger guard + cyan trigger
  const grip = box(g, 0.044, 0.105, 0.054, GRIP, 0, -0.072, 0.005);
  grip.rotation.x = 0.28;
  box(g, 0.02, 0.012, 0.055, DARK, 0, -0.048, 0.045);
  const trig = box(g, 0.01, 0.028, 0.012, cyanHi, 0, -0.032, 0.042, false);
  trig.rotation.x = -0.35;

  // Under-barrel capacitor magazine & angled foregrip
  const mag = box(g, 0.056, 0.085, 0.068, DARK, 0, -0.052, 0.135);
  mag.rotation.x = -0.12;
  box(g, 0.06, 0.016, 0.05, cyanSoft, 0, -0.085, 0.14, false); // glowing battery baseplate
  const fore = box(g, 0.038, 0.062, 0.042, GRIP, 0, -0.058, 0.22);
  fore.rotation.x = -0.22;

  // Twin magnetic rails + central fluted barrel
  const barrel = cyl(g, 0.013, 0.015, 0.25, STEEL_M, 0, 0.018, 0.28);
  barrel.rotation.x = Math.PI / 2;
  box(g, 0.016, 0.018, 0.24, TITANIUM, -0.026, 0.02, 0.285); // right rail blade
  box(g, 0.016, 0.018, 0.24, TITANIUM, 0.026, 0.02, 0.285); // left rail blade
  box(g, 0.056, 0.01, 0.024, cyanHi, 0, 0.02, 0.395, false); // muzzle arc bridge

  // 5 induction torus coils that spin and pulse when firing
  const coils = [];
  for (let i = 0; i < 5; i++) {
    const ringGrp = new THREE.Group();
    ringGrp.position.set(0, 0.018, 0.195 + i * 0.044);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.032, 0.0065, 8, 16),
      COPPER,
    );
    ringGrp.add(ring);
    const sparkNode = new THREE.Mesh(boxGeo(0.012, 0.012, 0.012), cyanHi);
    sparkNode.position.set(0.032, 0, 0);
    ringGrp.add(sparkNode);
    g.add(ringGrp);
    coils.push(ringGrp);
  }

  // Top Picatinny rail + Holographic Reflex Sight (aligned with sightY = 0.088)
  box(g, 0.036, 0.012, 0.22, DARK, 0, 0.054, 0.075);
  // Holo sight frame
  box(g, 0.046, 0.01, 0.056, DARK, 0, 0.064, 0.045);
  box(g, 0.007, 0.034, 0.044, DARK, -0.02, 0.082, 0.045);
  box(g, 0.007, 0.034, 0.044, DARK, 0.02, 0.082, 0.045);
  box(g, 0.046, 0.007, 0.044, DARK, 0, 0.1, 0.045);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.028), LENS_CYAN);
  lens.position.set(0, 0.082, 0.045);
  g.add(lens);
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.005, 0.0075, 16),
    cyanHi,
  );
  reticle.position.set(0, 0.082, 0.046);
  g.add(reticle);
  // Front sight post
  box(g, 0.008, 0.024, 0.01, DARK, 0, 0.062, 0.38);
  box(g, 0.008, 0.008, 0.008, cyanHi, 0, 0.076, 0.38, false);

  const fpHands = buildFpHands(g, 0.21, -0.05);
  return {
    group: g,
    muzzle: muzzleAt(g, 0.43, 0.018),
    fpHands,
    anim(t, kick) {
      for (let i = 0; i < coils.length; i++) {
        coils[i].rotation.z = t * (2.2 + i * 0.4) * (i % 2 ? 1 : -1) + kick * 5;
        const s = 1 + Math.sin(t * 9 - i * 0.9) * 0.05 + kick * 0.18;
        coils[i].scale.setScalar(s);
      }
      core.scale.set(1 + kick * 0.35, 1, 1 + kick * 0.35);
    },
  };
}

// 2. The Chrono-Bombard: Steampunk brass blunderbuss cannon with meshing clockwork gears, wind-up key & pressure gauge.
function chronoBombard() {
  const g = new THREE.Group();
  const amberGlow = glowMat("#ffbf47", 1.15),
    rubyGlow = glowMat("#ff3b30", 1.1);

  // Carved walnut flintlock stock with brass buttplate
  const stock = box(g, 0.052, 0.082, 0.13, WALNUT, 0, -0.022, -0.075);
  stock.rotation.x = 0.14;
  box(g, 0.056, 0.086, 0.018, BRASS_M, 0, -0.03, -0.14);
  const grip = box(g, 0.046, 0.105, 0.056, WOOD, 0, -0.075, 0.008);
  grip.rotation.x = 0.32;
  box(g, 0.022, 0.012, 0.055, BRASS_M, 0, -0.05, 0.045);

  // Main cylindrical brass boiler receiver + riveted bands
  const body = cyl(g, 0.05, 0.054, 0.18, BRASS_M, 0, 0.01, 0.065, 16);
  body.rotation.x = Math.PI / 2;
  for (const z of [-0.01, 0.065, 0.14]) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.006, 8, 18),
      COPPER,
    );
    band.position.set(0, 0.01, z);
    g.add(band);
  }
  // Glowing chrono-amber core chamber on top-front
  const tube = cyl(g, 0.02, 0.02, 0.09, amberGlow, 0, 0.055, 0.13, 12, false);
  tube.rotation.x = Math.PI / 2;

  // Heavy copper barrel + flared blunderbuss bell muzzle
  const barrel = cyl(g, 0.032, 0.038, 0.2, COPPER, 0, 0.014, 0.24, 14);
  barrel.rotation.x = Math.PI / 2;
  const bell = cyl(g, 0.056, 0.032, 0.085, BRASS_M, 0, 0.014, 0.365, 16);
  bell.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.009, 10, 18),
    GOLD_M,
  );
  rim.position.set(0, 0.014, 0.405);
  g.add(rim);
  // Dark bore interior
  const bore = cyl(g, 0.044, 0.025, 0.04, DARK, 0, 0.014, 0.39, 14, false);
  bore.rotation.x = Math.PI / 2;

  // Under-barrel wooden handguard + spring coil
  box(g, 0.048, 0.042, 0.15, WALNUT, 0, -0.032, 0.2);

  // Interlocking clockwork gears on BOTH sides (+X is inward toward FPS camera!)
  const gears = [];
  for (const side of [1, -1]) {
    const g1 = cyl(
      g,
      0.048,
      0.048,
      0.014,
      GOLD_M,
      side * 0.054,
      0.012,
      0.045,
      10,
    );
    g1.rotation.z = Math.PI / 2;
    const g2 = cyl(
      g,
      0.034,
      0.034,
      0.016,
      COPPER,
      side * 0.056,
      -0.004,
      0.115,
      8,
    );
    g2.rotation.z = Math.PI / 2;
    const g3 = cyl(
      g,
      0.024,
      0.024,
      0.018,
      BRASS_M,
      side * 0.058,
      0.028,
      0.155,
      7,
    );
    g3.rotation.z = Math.PI / 2;
    gears.push(
      { m: g1, dir: side },
      { m: g2, dir: -side * 1.4 },
      { m: g3, dir: side * 2 },
    );
  }

  // Top wind-up key (rotates continuously + spins fast on fire)
  const keyGrp = new THREE.Group();
  keyGrp.position.set(0, 0.068, 0.03);
  box(keyGrp, 0.014, 0.045, 0.014, GOLD_M, 0, 0.015, 0);
  box(keyGrp, 0.075, 0.016, 0.014, GOLD_M, 0, 0.038, 0);
  const loopL = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.005, 6, 12),
    GOLD_M,
  );
  loopL.position.set(-0.028, 0.042, 0);
  keyGrp.add(loopL);
  const loopR = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.005, 6, 12),
    GOLD_M,
  );
  loopR.position.set(0.028, 0.042, 0);
  keyGrp.add(loopR);
  g.add(keyGrp);

  // Steam pressure gauge on inward side (+X) so player sees the needle kick!
  const gaugeGrp = new THREE.Group();
  gaugeGrp.position.set(0.052, 0.048, 0.095);
  gaugeGrp.rotation.y = Math.PI / 2;
  const dialBezel = cyl(gaugeGrp, 0.024, 0.024, 0.012, BRASS_M, 0, 0, 0, 14);
  dialBezel.rotation.x = Math.PI / 2;
  const dialFace = cyl(
    gaugeGrp,
    0.02,
    0.02,
    0.014,
    stdMat("#f8f4e8", 0.3),
    0,
    0,
    0.001,
    14,
    false,
  );
  dialFace.rotation.x = Math.PI / 2;
  const needle = box(
    gaugeGrp,
    0.004,
    0.016,
    0.004,
    rubyGlow,
    0,
    0.005,
    0.009,
    false,
  );
  g.add(gaugeGrp);

  // Brass ring rear sight + front bead sight (aligned with sightY = 0.088)
  const rearSight = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.0035, 8, 16),
    BRASS_M,
  );
  rearSight.position.set(0, 0.086, -0.015);
  g.add(rearSight);
  box(g, 0.008, 0.018, 0.008, GOLD_M, 0, 0.076, 0.39);
  box(g, 0.009, 0.009, 0.009, amberGlow, 0, 0.086, 0.39, false);

  const fpHands = buildFpHands(g, 0.19, -0.042);
  return {
    group: g,
    muzzle: muzzleAt(g, 0.42, 0.014),
    fpHands,
    anim(t, kick) {
      const spin = t * 1.8 + kick * 8;
      for (const gr of gears) gr.m.rotation.x = spin * gr.dir;
      keyGrp.rotation.y = t * 2.4 + kick * 10;
      needle.rotation.z = -0.6 + Math.sin(t * 5) * 0.15 + kick * 2.2;
    },
  };
}

// 3. The Magma-Squeezer: Heavy 3-barrel rotary lava gatling blaster with spinning barrels, glowing heat vents & fuel canister.
function magmaSqueezer() {
  const g = new THREE.Group();
  const lavaHi = glowMat("#ff6b1a", 1.35),
    lavaCore = glowMat("#ffaa33", 1.1),
    redValve = stdMat("#d63031", 0.45);

  // Heavy industrial chassis & stock
  box(g, 0.06, 0.082, 0.1, DARK, 0, -0.01, -0.085);
  box(g, 0.094, 0.112, 0.19, IRON, 0, 0.004, 0.045);
  box(g, 0.098, 0.028, 0.16, HAZARD, 0, -0.038, 0.05); // hazard stripe lower trim
  // Glowing molten magma core & side heat-vent slots on BOTH sides
  box(g, 0.072, 0.065, 0.12, lavaCore, 0, 0.01, 0.065, false);
  for (let i = 0; i < 4; i++) {
    box(g, 0.098, 0.052, 0.012, IRON, 0, 0.01, 0.02 + i * 0.028);
  }

  // Pistol grip + trigger
  const grip = box(g, 0.048, 0.1, 0.058, GRIP, 0, -0.082, -0.005);
  grip.rotation.x = 0.25;
  box(g, 0.012, 0.028, 0.014, lavaHi, 0, -0.045, 0.032, false);

  // Pressurized underslung magma tank + valve wheel
  const tank = cyl(g, 0.046, 0.046, 0.165, COPPER, 0, -0.078, 0.135, 14);
  tank.rotation.x = Math.PI / 2;
  const tankBand1 = cyl(g, 0.049, 0.049, 0.02, IRON, 0, -0.078, 0.085, 14);
  tankBand1.rotation.x = Math.PI / 2;
  const tankBand2 = cyl(g, 0.049, 0.049, 0.02, IRON, 0, -0.078, 0.185, 14);
  tankBand2.rotation.x = Math.PI / 2;
  const cap = cyl(g, 0.026, 0.032, 0.028, DARK, 0, -0.078, 0.228, 12);
  cap.rotation.x = Math.PI / 2;

  // Spinning red pressure valve on top-rear
  const valveGrp = new THREE.Group();
  valveGrp.position.set(0, 0.072, -0.005);
  cyl(valveGrp, 0.012, 0.012, 0.028, STEEL_M, 0, 0, 0, 8);
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.026, 0.006, 6, 12),
    redValve,
  );
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = 0.015;
  valveGrp.add(wheel);
  box(valveGrp, 0.05, 0.007, 0.008, redValve, 0, 0.015, 0);
  box(valveGrp, 0.008, 0.007, 0.05, redValve, 0, 0.015, 0);
  g.add(valveGrp);

  // Rotary 3-barrel cluster that spins when firing!
  const rotor = new THREE.Group();
  rotor.position.set(0, 0.018, 0.26);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const bx = Math.cos(a) * 0.022,
      by = Math.sin(a) * 0.022;
    const b = cyl(rotor, 0.014, 0.014, 0.25, STEEL_M, bx, by, 0, 10);
    b.rotation.x = Math.PI / 2;
    const tip = cyl(rotor, 0.016, 0.015, 0.035, COPPER, bx, by, 0.125, 10);
    tip.rotation.x = Math.PI / 2;
    const glowTip = cyl(
      rotor,
      0.009,
      0.009,
      0.04,
      lavaHi,
      bx,
      by,
      0.128,
      8,
      false,
    );
    glowTip.rotation.x = Math.PI / 2;
  }
  // Dual rotor clamp rings
  const clamp1 = cyl(rotor, 0.042, 0.042, 0.022, IRON, 0, 0, -0.05, 14);
  clamp1.rotation.x = Math.PI / 2;
  const clamp2 = cyl(rotor, 0.042, 0.042, 0.022, COPPER, 0, 0, 0.075, 14);
  clamp2.rotation.x = Math.PI / 2;
  g.add(rotor);

  // Top carry handle & glowing iron sight (aligned with sightY = 0.09)
  box(g, 0.012, 0.032, 0.016, IRON, -0.024, 0.072, 0.075);
  box(g, 0.012, 0.032, 0.016, IRON, 0.024, 0.072, 0.075);
  box(g, 0.06, 0.01, 0.08, IRON, 0, 0.088, 0.075);
  box(g, 0.008, 0.008, 0.012, lavaHi, 0, 0.094, 0.11, false); // glowing front sight bead

  const fpHands = buildFpHands(g, 0.155, -0.065);
  let spinAngle = 0;
  return {
    group: g,
    muzzle: muzzleAt(g, 0.43, 0.018),
    fpHands,
    anim(t, kick, dt = 0.016) {
      spinAngle += dt * (1.5 + kick * 38);
      rotor.rotation.z = spinAngle;
      valveGrp.rotation.y = spinAngle * 0.6;
    },
  };
}

// 4. The Bioshocker: Alien symbiote spore cannon with breathing bioluminescent sacs, bubbling vials & flaring mandibles.
function bioshocker() {
  const g = new THREE.Group();
  const bioBright = glowMat("#7ee83c", 1.25),
    bioSacMat = glowMat("#4ade80", 0.78);

  // Armored dark-purple chitin carapace over organic body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 10), CHITIN);
  body.scale.set(0.82, 0.92, 1.95);
  body.position.set(0, 0.005, 0.055);
  g.add(body);

  const rearPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.058, 12, 9),
    CHITIN_HI,
  );
  rearPod.scale.set(0.88, 0.82, 1.25);
  rearPod.position.set(0, 0.008, -0.095);
  g.add(rearPod);

  // Segmented bone spine ridges along top
  for (let i = 0; i < 5; i++) {
    const rib = box(
      g,
      0.022,
      0.024,
      0.026,
      BONE,
      0,
      0.068 - i * 0.003,
      -0.04 + i * 0.05,
    );
    rib.rotation.x = -0.25;
  }

  // Ribbed bone bio-barrel + glowing acid maw
  const nozzle = cyl(g, 0.028, 0.04, 0.17, BONE, 0, 0.008, 0.255, 12);
  nozzle.rotation.x = Math.PI / 2;
  const maw = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), bioBright);
  maw.position.set(0, 0.008, 0.34);
  g.add(maw);

  // 3 articulated alien mandible claws around the muzzle that flare open when firing
  const claws = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.028, 0.008 + Math.sin(a) * 0.028, 0.31);
    pivot.rotation.z = a - Math.PI / 2;
    const claw = cyl(pivot, 0.004, 0.013, 0.085, BONE, 0, 0.01, 0.038, 7);
    claw.rotation.x = Math.PI / 2 + 0.28;
    g.add(pivot);
    claws.push(pivot);
  }

  // 3 glowing green mutagen vials on top
  const vials = [];
  for (const [x, z, tilt] of [
    [-0.034, 0.015, -0.42],
    [0.034, 0.045, 0.38],
    [-0.026, 0.105, -0.25],
  ]) {
    const vGrp = new THREE.Group();
    vGrp.position.set(x, 0.072, z);
    vGrp.rotation.z = tilt * 0.6;
    const vial = cyl(
      vGrp,
      0.016,
      0.016,
      0.082,
      bioBright,
      0,
      0.022,
      0,
      10,
      false,
    );
    const cap = cyl(vGrp, 0.019, 0.019, 0.016, DARK, 0, 0.066, 0, 10);
    g.add(vGrp);
    vials.push(vGrp);
  }

  // Pulsating bioluminescent spore sacs on both sides
  const sacs = [];
  for (const side of [1, -1]) {
    const sac = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 10, 8),
      bioSacMat,
    );
    sac.position.set(side * 0.058, 0.005, 0.115);
    g.add(sac);
    sacs.push(sac);
  }

  // Organic bone grip + knuckle guard
  const grip = box(g, 0.044, 0.098, 0.052, BONE, 0, -0.082, 0.002);
  grip.rotation.x = 0.28;
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), BONE);
  knuckle.scale.set(0.8, 1.3, 1);
  knuckle.position.set(0, -0.075, 0.048);
  g.add(knuckle);

  // Bio-optic sight ring on top (aligned with sightY = 0.088)
  const bioRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.0035, 8, 16),
    BONE,
  );
  bioRing.position.set(0, 0.088, -0.02);
  g.add(bioRing);
  const bioLens = new THREE.Mesh(
    new THREE.CircleGeometry(0.014, 12),
    LENS_GREEN,
  );
  bioLens.position.set(0, 0.088, -0.02);
  g.add(bioLens);
  const bioDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.004, 6, 6),
    bioBright,
  );
  bioDot.position.set(0, 0.088, -0.019);
  g.add(bioDot);

  const fpHands = buildFpHands(g, 0.18, -0.042);
  return {
    group: g,
    muzzle: muzzleAt(g, 0.39, 0.008),
    fpHands,
    anim(t, kick) {
      const pulse = 1 + Math.sin(t * 4.5) * 0.08 + kick * 0.35;
      for (const s of sacs) s.scale.set(pulse, pulse * 0.85, pulse * 1.25);
      maw.scale.setScalar(1 + kick * 0.55);
      for (let i = 0; i < claws.length; i++) {
        claws[i].children[0].rotation.x =
          Math.PI / 2 + 0.28 - kick * 0.55 - Math.sin(t * 3 + i) * 0.05;
      }
      for (let i = 0; i < vials.length; i++) {
        vials[i].position.y =
          0.072 + Math.sin(t * 6 + i * 2) * 0.004 - kick * 0.012;
      }
    },
  };
}

const GUNS = [
  {
    name: "Scrap-Coil",
    role: "Plasma Railgun",
    hex: "#7dd8ff",
    build: scrapCoil,
    cool: 0.325,
    mag: 8,
    reloadTime: 1.35,
    sightY: 0.084,
    recoil: 1.0,
    proj: {
      kind: "bolt",
      color: 0x7dd8ff,
      size: 0.042,
      speed: 25,
      grav: 0,
      dmg: 25,
      arcDmg: 13,
    },
  },
  {
    name: "Chrono-Bombard",
    role: "Cluster Cannon",
    hex: "#f2c94c",
    build: chronoBombard,
    cool: 0.52,
    mag: 4,
    reloadTime: 1.75,
    sightY: 0.086,
    recoil: 1.55,
    proj: {
      kind: "ball",
      color: 0xc9a35c,
      size: 0.068,
      speed: 13.5,
      grav: 6.2,
      dmg: 58,
      splashDmg: 42,
    },
  },
  {
    name: "Magma-Squeezer",
    role: "Rotary Gattling",
    hex: "#ff7a26",
    build: magmaSqueezer,
    cool: 0.11,
    mag: 24,
    reloadTime: 1.95,
    sightY: 0.088,
    recoil: 0.65,
    proj: {
      kind: "fire",
      color: 0xff7a26,
      size: 0.054,
      speed: 16.5,
      grav: 2.2,
      dmg: 15,
    },
  },
  {
    name: "Bioshocker",
    role: "Bouncy Bio-Launcher",
    hex: "#7ee83c",
    build: bioshocker,
    cool: 0.38,
    mag: 6,
    reloadTime: 1.5,
    sightY: 0.088,
    recoil: 1.15,
    proj: {
      kind: "goo",
      color: 0x7ee83c,
      size: 0.074,
      speed: 14,
      grav: 4.4,
      dmg: 34,
      splashDmg: 14,
    },
  },
];

/* ================= Synthesized WebAudio Sound Effects ================= */
let sfxCtx = null,
  sfxOut = null;
function getAudio() {
  if (typeof window === "undefined") return null;
  if (!sfxCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sfxCtx = new Ctx();
    sfxOut = sfxCtx.createGain();
    sfxOut.gain.value = 0.28;
    sfxOut.connect(sfxCtx.destination);
  }
  if (sfxCtx.state === "suspended") sfxCtx.resume().catch(() => {});
  return sfxCtx;
}

function playGunSound(kind) {
  const c = getAudio();
  if (!c) return;
  const t = c.currentTime;
  if (kind === "bolt") {
    // Sci-fi railgun zap: high-to-low frequency sweep + crisp crackle
    const o = c.createOscillator(),
      o2 = c.createOscillator(),
      g = c.createGain();
    o.type = "sawtooth";
    o2.type = "triangle";
    o.frequency.setValueAtTime(1450, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.14);
    o2.frequency.setValueAtTime(2200, t);
    o2.frequency.exponentialRampToValueAtTime(280, t + 0.11);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g);
    o2.connect(g);
    g.connect(sfxOut);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.16);
    o2.stop(t + 0.16);
  } else if (kind === "ball") {
    // Steampunk cannon thump + brass gear ping
    const o = c.createOscillator(),
      ping = c.createOscillator(),
      g = c.createGain(),
      gp = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    ping.type = "sine";
    ping.frequency.setValueAtTime(1180, t + 0.02);
    ping.frequency.exponentialRampToValueAtTime(640, t + 0.14);
    gp.gain.setValueAtTime(0.16, t + 0.02);
    gp.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(sfxOut);
    ping.connect(gp).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.25);
    ping.start(t + 0.02);
    ping.stop(t + 0.16);
  } else if (kind === "fire") {
    // Rapid rotary magma punch
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(340 + Math.random() * 80, t);
    o.frequency.exponentialRampToValueAtTime(68, t + 0.09);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.11);
  } else if (kind === "goo") {
    // Squishy bio-launcher blorp
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(680, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.18);
    g.gain.setValueAtTime(0.36, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o.connect(g).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.2);
  } else if (kind === "hit") {
    // Crisp FPS hitmarker tick
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(1650, t);
    o.frequency.exponentialRampToValueAtTime(920, t + 0.055);
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    o.connect(g).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.07);
  } else if (kind === "ko") {
    // Satisfying knockout double-chime + low thud
    const o1 = c.createOscillator(),
      o2 = c.createOscillator(),
      g = c.createGain();
    o1.type = "triangle";
    o2.type = "sine";
    o1.frequency.setValueAtTime(980, t);
    o1.frequency.setValueAtTime(1480, t + 0.055);
    o2.frequency.setValueAtTime(180, t);
    o2.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.36, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o1.connect(g);
    o2.connect(g);
    g.connect(sfxOut);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.23);
    o2.stop(t + 0.23);
  } else if (kind === "equip") {
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.05);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.065);
  } else if (kind === "reloadStart") {
    // Magazine release click + slide-out whirr
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(480, t);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.12);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(sfxOut);
    o.start(t);
    o.stop(t + 0.14);
  } else if (kind === "reloadDone") {
    // Fresh magazine lock-in + bolt rack chk-chk
    const o1 = c.createOscillator(),
      o2 = c.createOscillator(),
      g = c.createGain();
    o1.type = "triangle";
    o2.type = "triangle";
    o1.frequency.setValueAtTime(420, t);
    o1.frequency.exponentialRampToValueAtTime(760, t + 0.05);
    o2.frequency.setValueAtTime(680, t + 0.06);
    o2.frequency.exponentialRampToValueAtTime(1180, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o1.connect(g);
    o2.connect(g);
    g.connect(sfxOut);
    o1.start(t);
    o1.stop(t + 0.055);
    o2.start(t + 0.06);
    o2.stop(t + 0.14);
  }
}

/* ================= State & VFX Pools ================= */
const GREEN = 0x39d353; // all the "blood" in this office
const shots = [],
  splats = [],
  stains = [],
  shells = [],
  flashes = [],
  beams = [],
  rings = [];

// FPS camera-attached viewmodel root so the gun is always crisp and visible in first-person
const vmRoot = new THREE.Group();
scene.add(vmRoot);

const muzzleLight = new THREE.PointLight(0xffffff, 0, 4.5);
scene.add(muzzleLight);
let muzzleLightT = 0;

let rig = null, // { body, guns: [{group, muzzle, fpHands, anim, rest}] }
  armed = false,
  aiming = false, // right button held: sight down the gun (zoom + ADS sight alignment)
  firingHeld = false, // left button held in pointer-lock: continuous fire
  ads = 0, // 0..1 aim-down-sights blend
  savedFov = null,
  cross = null,
  crossBars = [],
  hitMark = null,
  hitSlashes = [],
  hitMarkT = 0,
  hudEl = null,
  hudSlots = [],
  ammoPanelEl = null,
  ammoNumEl = null,
  ammoSubEl = null,
  reloadPillEl = null,
  reloadFillEl = null,
  ammo = GUNS.map((g) => g.mag),
  reloadLeft = 0,
  reloadDur = 0,
  boardEl = null,
  boardListEl = null,
  killCounts = new Map(),
  boardDirty = true,
  lastControlledKey = null,
  hpLayer = null,
  hpCards = new Map(),
  popups = [],
  aimedPerson = null,
  cd = 0,
  tap = null,
  projGeo = null,
  splatGeo = null,
  shellGeo = null,
  ringGeo = null;

// Procedural FPS motion state
let animClock = 0,
  equipT = 0, // 1 -> 0 spring when switching guns
  recZ = 0, // backward kick
  recPitch = 0, // upward muzzle climb
  recRoll = 0, // twist on shot
  swayX = 0,
  swayY = 0,
  lastYaw = null,
  lastPitch = null,
  bobPhase = 0,
  sprintBlend = 0,
  dipY = 0,
  dipVel = 0,
  wasAir = false;

const _v = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _r = new THREE.Vector3();

const armedNow = () =>
  armed &&
  player.controlling &&
  player.person &&
  !player.sitting &&
  player.gun != null;

/* ================= FPS Viewmodel & Third-Person Sync ================= */
function syncGun(dt = 0.016) {
  const p = player.person,
    body = armed && p && player.controlling ? p.body : null;
  if (rig && rig.body !== body) {
    for (const g of rig.guns) g.group.removeFromParent();
    rig = null;
  }
  if (body && !rig) {
    rig = {
      body,
      guns: GUNS.map((def) => {
        const built = def.build();
        const { group, muzzle, fpHands, anim } = built;
        vmRoot.add(group);
        group.visible = false;
        return {
          group,
          muzzle,
          fpHands,
          anim,
        };
      }),
    };
  }
  if (!rig) return;

  const isFP = ctl.active && (ctl.mode === "fp" || !p.body.root.visible);
  if (isFP) {
    vmRoot.position.copy(camera.position);
    vmRoot.quaternion.copy(camera.quaternion);
  } else {
    vmRoot.position.set(0, 0, 0);
    vmRoot.quaternion.identity();
  }

  // Update FPS hand/sleeve colors to match the currently controlled character
  const skinColor = p?.spec?.skin || "#e8b59a",
    topColor = p?.spec?.top?.color || "#3e6e9c";

  for (let i = 0; i < rig.guns.length; i++) {
    const gg = rig.guns[i],
      gr = gg.group,
      def = GUNS[i];
    const show = i === player.gun && armedNow();
    gr.visible = show;
    if (!show) continue;

    // Animate moving parts on the active gun (spinning coils, clockwork gears, gatling barrels, bio-sacs)
    const relProg =
      reloadLeft > 0 && reloadDur > 0 ? 1 - reloadLeft / reloadDur : 0;
    const relWave = reloadLeft > 0 ? Math.sin(relProg * Math.PI) : 0;
    const relInsert = reloadLeft > 0 ? Math.sin(relProg * Math.PI * 2) : 0;
    const kickAmt = Math.min(1, recZ * 16 + relWave * 0.45);
    if (gg.anim) gg.anim(animClock, kickAmt, dt);

    if (isFP) {
      if (gg.fpHands) {
        gg.fpHands.visible = true;
        gg.fpHands.userData.skinMat.color.set(skinColor);
        gg.fpHands.userData.sleeveMat.color.set(topColor);
      }

      // Hip-fire vs Aim-Down-Sights (ADS) target in camera space
      // At ads = 1, x = 0 and y = -def.sightY places the optical/iron sight right at screen center!
      const hipX = 0.175 - sprintBlend * 0.055,
        hipY = -0.145 - sprintBlend * 0.025,
        hipZ = -0.33 + sprintBlend * 0.03;
      const adsX = 0,
        adsY = -def.sightY,
        adsZ = -0.245;

      const adsEase = ads * ads * (3 - 2 * ads) * (1 - relWave);
      const swayScale = 1 - adsEase * 0.78;

      // Idle figure-8 breathing + walk/sprint bob
      const breatheX = Math.cos(animClock * 1.1) * 0.0025 * swayScale,
        breatheY = Math.sin(animClock * 2.2) * 0.003 * swayScale;
      const moveAmp = (player.moving ? 1 : 0) * (1 - adsEase * 0.75);
      const runMul = keys.has("shift") ? 1.65 : 1;
      const bobX = Math.cos(bobPhase) * 0.012 * moveAmp * runMul,
        bobY = -Math.abs(Math.sin(bobPhase)) * 0.015 * moveAmp * runMul;

      // Equip raise offset + Reload dip/pump offsets
      const eq = equipT * equipT;
      const relX = -relWave * 0.045,
        relY = -relWave * 0.095 + Math.max(0, -relInsert) * 0.035,
        relZ = relWave * 0.04;

      const px =
        hipX +
        (adsX - hipX) * adsEase +
        swayX * swayScale +
        breatheX +
        bobX +
        relX;
      const py =
        hipY +
        (adsY - hipY) * adsEase +
        swayY * swayScale +
        breatheY +
        bobY +
        dipY -
        eq * 0.22 -
        recZ * 0.18 +
        relY;
      const pz = hipZ + (adsZ - hipZ) * adsEase + recZ + relZ;

      gr.position.set(px, py, pz);

      // Orientation: rotation.y = Math.PI points the +Z gun barrel down camera -Z
      // Note: because rotation.y is PI, positive rotation.x pitches the +Z muzzle UP!
      const hipToeY = 0.045 * (1 - adsEase) + sprintBlend * 0.38,
        hipPitchX = -0.018 * (1 - adsEase) - sprintBlend * 0.22;
      const pitchRot =
        hipPitchX +
        recPitch +
        swayY * 1.4 * swayScale -
        dipY * 1.6 -
        eq * 0.65 -
        relWave * 0.42 +
        relInsert * 0.14;
      const yawRot =
        Math.PI + hipToeY - swayX * 1.6 * swayScale + relWave * 0.32;
      const rollRot =
        recRoll -
        swayX * 2.1 * swayScale -
        Math.cos(bobPhase) * 0.025 * moveAmp * runMul -
        sprintBlend * 0.25 +
        eq * 0.35 -
        relWave * 0.65;

      gr.rotation.order = "YXZ";
      gr.rotation.set(pitchRot, yawRot, rollRot);
    } else {
      // Third-person world-space placement anchored to the character's right hand
      if (gg.fpHands) gg.fpHands.visible = false;
      const hand = rig.body.sockets.rightHand;
      hand.updateWorldMatrix(true, false);
      hand.getWorldPosition(_v);

      camera.getWorldDirection(_d);
      _d.y = 0;
      if (_d.lengthSq() > 1e-6) _d.normalize();
      else _d.set(Math.sin(p.face), 0, Math.cos(p.face));
      _r.set(-_d.z, 0, _d.x);

      // Hand grip position pushed slightly forward along aim direction
      _v.addScaledVector(_d, 0.05 - recZ * 0.7);
      _v.y += 0.02 - relWave * 0.08;

      // Shouldered ADS position near cheek level
      _b.copy(p.pos);
      _b.y += (rig.body.eyeY || 1.38) - 0.06 - relWave * 0.08;
      _b.addScaledVector(_d, 0.32 - recZ * 0.7);
      _b.addScaledVector(_r, 0.12);

      gr.position.lerpVectors(_v, _b, ads * (1 - relWave));
      gr.lookAt(aimPoint(_c));
      gr.rotateX(-recPitch * 0.6 + relWave * 0.45);
    }
  }
  vmRoot.updateMatrixWorld(true);
}

function gunsShow(on) {
  armed = on;
  if (!on) {
    aiming = false;
    firingHeld = false;
    reloadLeft = 0;
  } else {
    equipT = 1;
  }
}

function selectGun(i) {
  if (i == null) {
    player.gun = null;
    reloadLeft = 0;
    syncGun();
    return;
  }
  if (i >= 0 && i < GUNS.length) {
    if (player.gun !== i) {
      equipT = 1;
      reloadLeft = 0;
      playGunSound("equip");
    }
    player.gun = i;
  }
  syncGun();
}

function reloadGun() {
  if (!armedNow() || reloadLeft > 0) return false;
  const gIdx = player.gun,
    def = GUNS[gIdx];
  if (!def || ammo[gIdx] >= def.mag) return false;
  reloadDur = def.reloadTime || 1.5;
  reloadLeft = reloadDur;
  playGunSound("reloadStart");
  if (rig) {
    const g = rig.guns[gIdx];
    g.muzzle.getWorldPosition(_v);
    spawnShell(_v, def.hex);
  }
  return true;
}

/* ================= Projectiles, Muzzle Flash, Shells & Impacts ================= */
function spawnMuzzleFlash(pos, dir, hex) {
  const g = new THREE.Group();
  g.position.copy(pos);
  const mat = glowMat(hex, 1.8);
  for (let i = 0; i < 3; i++) {
    const spike = new THREE.Mesh(boxGeo(0.018, 0.018, 0.13), mat);
    spike.rotation.z = (i * Math.PI) / 3;
    spike.rotation.x = (Math.random() - 0.5) * 0.5;
    g.add(spike);
  }
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 8, 6),
    glowMat("#ffffff", 2.0),
  );
  g.add(core);
  g.lookAt(_c.copy(pos).add(dir));
  scene.add(g);
  flashes.push({ m: g, life: 0.055 });

  muzzleLight.color.set(hex);
  muzzleLight.intensity = 2.6;
  muzzleLight.position.copy(pos);
  muzzleLightT = 0.06;
}

function spawnShell(pos, hex) {
  shellGeo ??= new THREE.CylinderGeometry(0.008, 0.008, 0.028, 6);
  const mat = hex ? glowMat(hex, 0.6) : BRASS_M;
  const m = new THREE.Mesh(shellGeo, mat);
  m.position.copy(pos);
  camera.getWorldDirection(_d);
  _r.set(-_d.z, 0, _d.x).normalize();
  scene.add(m);
  shells.push({
    m,
    vx: _r.x * (1.2 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.4,
    vy: 1.4 + Math.random() * 0.9,
    vz: _r.z * (1.2 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.4,
    rx: (Math.random() - 0.5) * 18,
    rz: (Math.random() - 0.5) * 18,
    life: 0.9,
  });
}

function spawnBeam(from, to, hex) {
  const dist = from.distanceTo(to);
  if (dist < 0.05) return;
  const g = new THREE.CylinderGeometry(0.009, 0.009, dist, 6);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, glowMat(hex, 1.6));
  m.position.copy(from).lerp(to, 0.5);
  m.lookAt(to);
  scene.add(m);
  beams.push({ m, life: 0.12, max: 0.12 });
}

function spawnRing(x, y, z, hex, maxScale = 1.4) {
  ringGeo ??= new THREE.RingGeometry(0.18, 0.26, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(ringGeo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, Math.max(0.03, y), z);
  scene.add(m);
  rings.push({ m, life: 0.28, max: 0.28, maxScale });
}

function spawnShot(def, from, dir, extra = {}) {
  projGeo ??= new THREE.SphereGeometry(1, 10, 8);
  const hexStr =
    def.color === 0xc9a35c
      ? "#f2c94c"
      : "#" + def.color.toString(16).padStart(6, "0");
  const m = new THREE.Mesh(projGeo, glowMat(hexStr, 1.35));
  const sz = (extra.scale ?? 1) * def.size;
  m.scale.setScalar(sz);

  if (def.kind === "ball") {
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.28, 6, 14),
      GOLD_M,
    );
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.22, 6, 12),
      COPPER,
    );
    ring2.rotation.x = Math.PI / 2;
    m.add(ring1, ring2);
  } else if (def.kind === "bolt") {
    m.scale.set(sz * 0.75, sz * 0.75, sz * 2.8);
    m.lookAt(_c.copy(from).add(dir));
  } else if (def.kind === "goo") {
    const halo = new THREE.Mesh(
      projGeo,
      new THREE.MeshBasicMaterial({
        color: 0x7ee83c,
        transparent: true,
        opacity: 0.35,
      }),
    );
    halo.scale.setScalar(1.38);
    m.add(halo);
  }

  m.position.copy(from).addScaledVector(dir, 0.06);
  scene.add(m);
  shots.push({
    m,
    shooter: player.person,
    hex: hexStr,
    vx: dir.x * def.speed,
    vy: dir.y * def.speed,
    vz: dir.z * def.speed,
    grav: def.grav,
    kind: def.kind,
    dmg: extra.dmg ?? def.dmg ?? 34,
    splashDmg: extra.splashDmg ?? def.splashDmg ?? 0,
    arcDmg: def.arcDmg ?? 0,
    size: sz,
    bounces: def.kind === "goo" ? 2 : def.kind === "ball" ? 1 : 0,
    trailT: 0,
    life: RANGE / def.speed,
  });
}

const isKnockedOut = (q) => q.down > 0 || q.task?.anim === "slapKO";

// The world point the crosshair sits on: the closest standing person within a cone of the camera
// ray, else a spot downrange. Gun barrels look at it and shots converge on it.
function aimPoint(out) {
  camera.getWorldPosition(_a);
  camera.getWorldDirection(_w);
  let bd = RANGE * 0.65,
    bestP = null;
  for (const q of people) {
    if (q === player.person || q.state === "away" || isKnockedOut(q)) continue;
    _b.set(q.pos.x - _a.x, q.pos.y + 1.0 - _a.y, q.pos.z - _a.z);
    const t = _b.dot(_w);
    if (t < 0.4 || t > bd) continue;
    const px = _a.x + _w.x * t - q.pos.x,
      pz = _a.z + _w.z * t - q.pos.z;
    if (Math.hypot(px, pz) < 0.5) {
      bd = t;
      bestP = q;
    }
  }
  aimedPerson = bestP;
  return out.copy(_a).addScaledVector(_w, bd);
}
function aimDir(from) {
  aimPoint(_c);
  return _w.set(_c.x - from.x, _c.y - from.y, _c.z - from.z).normalize();
}

function fire() {
  if (!armedNow() || cd > 0 || reloadLeft > 0 || !rig) return;
  const gIdx = player.gun,
    def = GUNS[gIdx],
    g = rig.guns[gIdx];
  if (ammo[gIdx] <= 0) {
    reloadGun();
    return;
  }
  ammo[gIdx] -= 1;
  syncGun(0);
  cd = def.cool;
  g.muzzle.getWorldPosition(_v);
  const dir = aimDir(_v).clone();

  // Apply snappy FPS recoil kick + tiny camera punch
  const recMul = (def.recoil || 1) * (ads > 0.5 ? 0.58 : 1);
  recZ = Math.min(0.09, recZ + 0.042 * recMul);
  recPitch = Math.min(0.22, recPitch + 0.075 * recMul);
  recRoll = (Math.random() - 0.5) * 0.07 * recMul;
  if (ctl.active) {
    ctl.pitch = Math.min(ctl.pitchMax, ctl.pitch + 0.008 * recMul);
  }

  spawnMuzzleFlash(_v, dir, def.hex);
  spawnShell(_v, def.proj.kind === "bolt" ? "#7dd8ff" : null);
  playGunSound(def.proj.kind);

  if (def.proj.kind === "fire") {
    // Rotary Magma Gattling: main fireball + slight spread ember
    const spread = (1 - ads * 0.65) * 0.028;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    spawnShot(def.proj, _v, dir);
  } else if (def.proj.kind === "goo") {
    // Bioshocker: main bouncing slime glob + 2 mini satellite spores
    spawnShot(def.proj, _v, dir);
    for (const s of [-1, 1]) {
      const subDir = dir.clone();
      subDir.x += s * 0.045 + (Math.random() - 0.5) * 0.02;
      subDir.y += 0.025 + Math.random() * 0.02;
      subDir.z += (Math.random() - 0.5) * 0.03;
      subDir.normalize();
      spawnShot(def.proj, _v, subDir, { scale: 0.52, dmg: 15, splashDmg: 0 });
    }
  } else if (def.proj.kind === "bolt") {
    // Scrap-Coil Railgun: fast plasma bolt + electric tracer beam
    spawnShot(def.proj, _v, dir);
    spawnBeam(_v, _c.copy(_v).addScaledVector(dir, 5.5), def.hex);
  } else {
    // Chrono-Bombard: heavy clockwork bomb + golden muzzle sparks
    spawnShot(def.proj, _v, dir);
    splat(_v.x, _v.y, _v.z, false, "#f2c94c");
  }

  // Automatically start reloading when the magazine runs dry!
  if (ammo[gIdx] <= 0) {
    reloadGun();
  }
}

// Right click sights down the gun; left click shoots (and holds for continuous fire in pointer-lock).
function gunDown(e) {
  if (e.button === 2) {
    aiming = armedNow();
    return;
  }
  if (!armedNow() || e.button !== 0) return;
  if (document.pointerLockElement) {
    firingHeld = true;
    fire();
  } else tap = { x: e.clientX, y: e.clientY, t: performance.now() };
}
function gunUp(e) {
  if (e.button === 2) {
    aiming = false;
    return;
  }
  if (e.button === 0) firingHeld = false;
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

// Colored particle burst + green splat droplets
function splat(x, y, z, big = false, hex = "#39d353") {
  splatGeo ??= new THREE.SphereGeometry(1, 6, 5);
  const n = big ? 14 : 6;
  for (let i = 0; i < n; i++) {
    const c = big && i % 3 === 0 ? "#39d353" : hex;
    const m = new THREE.Mesh(splatGeo, glowMat(c, 0.75));
    m.scale.setScalar(0.016 + Math.random() * (big ? 0.038 : 0.025));
    m.position.set(x, y, z);
    scene.add(m);
    const sp = big ? 3.2 : 2.2;
    splats.push({
      m,
      vx: (Math.random() - 0.5) * sp,
      vy: 0.9 + Math.random() * (big ? 2.6 : 1.8),
      vz: (Math.random() - 0.5) * sp,
      life: 0.5 + Math.random() * 0.35,
    });
  }
}

function stain(x, z, color = GREEN, rad = 0.32) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(rad, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  scene.add(m);
  stains.push({ m, life: DOWN + 0.4 });
}

function spawnPopup(x, y, z, text, color = "#ffffff", big = false) {
  ensureHUD();
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;font:800 ${big ? 15 : 12.5}px var(--f-sans,system-ui,sans-serif);color:${color};text-shadow:0 1px 4px rgba(0,0,0,0.95),0 0 8px rgba(0,0,0,0.6);white-space:nowrap;z-index:79;transform:translate(-50%,-50%)`;
  hpLayer.appendChild(el);
  popups.push({
    el,
    x: x + (Math.random() - 0.5) * 0.22,
    y: y + 0.15,
    z: z + (Math.random() - 0.5) * 0.22,
    vy: big ? 1.15 : 0.85,
    life: big ? 0.85 : 0.62,
    max: big ? 0.85 : 0.62,
  });
}

function killerKey(p) {
  if (!p) return "You";
  return p.id === -1 ? "You" : p.name || "You";
}

function recordKill(killer) {
  const k = killerKey(killer || player.person);
  const entry = killCounts.get(k) || { name: k, kills: 0, t: 0 };
  entry.kills += 1;
  entry.t = performance.now();
  killCounts.set(k, entry);
  boardDirty = true;
}

function knock(p, hex = "#39d353", killer = null) {
  p.hp = 0;
  p.down = DOWN;
  p.wasDown = true;
  p.flinch = 0;
  p.dizzy = false;
  recordKill(killer || player.person);
  stain(p.pos.x, p.pos.z, GREEN, 0.34);
  splat(p.pos.x, 0.9, p.pos.z, true, hex);
  spawnRing(p.pos.x, 0.1, p.pos.z, hex, 1.15);
  spawnPopup(
    p.pos.x,
    (p.body?.eyeY || 1.4) + 0.35,
    p.pos.z,
    "KO! 2s",
    "#ff4d4f",
    true,
  );
  setHitmarker(true, "#ff4d4f");
  playGunSound("ko");
}

// Apply balanced weapon damage to a character's health bar; knocks them out for 2s when HP hits 0!
function damagePerson(
  p,
  rawDmg,
  hex = "#39d353",
  isHeadshot = false,
  killer = null,
) {
  if (!p || p === player.person || p.state === "away" || p.down > 0) return;
  if (p.hp == null) {
    p.hp = MAX_HP;
    p.hpLag = MAX_HP;
  }
  const dmg = Math.max(1, Math.round(rawDmg * (isHeadshot ? 1.45 : 1)));
  p.hp = Math.max(0, p.hp - dmg);
  p.hurtCd = REGEN_DELAY;
  p.hpShowT = 2.0;

  if (p.hp <= 0) {
    knock(p, hex, killer);
  } else {
    // Hit flinch reaction + small particle burst + floating damage number
    p.flinch = 1.0;
    p.flinchSide = Math.random() < 0.5 ? -1 : 1;
    splat(p.pos.x, 0.95, p.pos.z, false, hex);
    spawnPopup(
      p.pos.x,
      (p.body?.eyeY || 1.4) + 0.25,
      p.pos.z,
      isHeadshot ? `CRIT -${dmg}` : `-${dmg}`,
      isHeadshot ? "#ffd166" : hex,
      isHeadshot,
    );
    setHitmarker(false, isHeadshot ? "#ffd166" : "#ffffff");
    playGunSound("hit");
  }
}

function onProjectileImpact(s, x, y, z, directPerson = null) {
  const isHead =
    directPerson &&
    y >= directPerson.pos.y + (directPerson.body?.eyeY || 1.38) - 0.16;
  const shooter = s.shooter || player.person;

  if (s.kind === "bolt") {
    // Scrap-Coil: precision plasma bolt + chain-lightning arc to a nearby coworker!
    splat(x, y, z, false, "#7dd8ff");
    spawnRing(x, y, z, 0x7dd8ff, 0.9);
    if (directPerson) {
      damagePerson(directPerson, s.dmg, "#7dd8ff", isHead, shooter);
      let closest = null,
        bestD = 3.0;
      for (const q of people) {
        if (
          q === player.person ||
          q === directPerson ||
          q.state === "away" ||
          q.down > 0
        )
          continue;
        const d = Math.hypot(q.pos.x - x, q.pos.z - z);
        if (d < bestD) {
          bestD = d;
          closest = q;
        }
      }
      if (closest) {
        spawnBeam(
          _a.set(x, 0.95, z),
          _b.set(closest.pos.x, 0.95, closest.pos.z),
          "#7dd8ff",
        );
        damagePerson(closest, s.arcDmg || 13, "#7dd8ff", false, shooter);
      }
    }
  } else if (s.kind === "ball") {
    // Chrono-Bombard: direct cannon impact + AoE golden shockwave blast with distance falloff!
    splat(x, Math.max(0.15, y), z, true, "#f2c94c");
    spawnRing(x, 0.08, z, 0xf2c94c, 1.85);
    stain(x, z, 0xc9a35c, 0.42);
    if (directPerson) {
      damagePerson(directPerson, s.dmg, "#f2c94c", isHead, shooter);
    }
    for (const q of people) {
      if (q === player.person || q === directPerson || q.state === "away")
        continue;
      const d = Math.hypot(q.pos.x - x, q.pos.z - z);
      if (d < 1.55) {
        const falloff = 1 - (d / 1.55) * 0.55;
        damagePerson(
          q,
          (s.splashDmg || 42) * falloff,
          "#f2c94c",
          false,
          shooter,
        );
      }
    }
  } else if (s.kind === "fire") {
    // Magma-Squeezer: rapid-fire molten fireball + lava puddle
    splat(x, Math.max(0.1, y), z, false, "#ff7a26");
    stain(x, z, 0xff5500, 0.22);
    if (directPerson) {
      damagePerson(directPerson, s.dmg, "#ff7a26", isHead, shooter);
    }
  } else if (s.kind === "goo") {
    // Bioshocker: toxic slime glob + splash shower
    splat(x, Math.max(0.12, y), z, s.splashDmg > 0, "#7ee83c");
    stain(x, z, GREEN, s.splashDmg > 0 ? 0.36 : 0.2);
    if (s.splashDmg > 0) spawnRing(x, 0.06, z, 0x7ee83c, 1.2);
    if (directPerson) {
      damagePerson(directPerson, s.dmg, "#7ee83c", isHead, shooter);
    }
    if (s.splashDmg > 0) {
      for (const q of people) {
        if (q === player.person || q === directPerson || q.state === "away")
          continue;
        if (Math.hypot(q.pos.x - x, q.pos.z - z) < 0.9) {
          damagePerson(q, s.splashDmg, "#7ee83c", false, shooter);
        }
      }
    }
  }
}

const hitY = (q, y) => y > q.pos.y && y < q.pos.y + 1.55;

/* ================= Dynamic FPS Crosshair, Hitmarker, Weapon HUD & Overhead Health Bars ================= */
function setHitmarker(big = false, color = "#ffffff") {
  ensureHUD();
  hitMarkT = big ? 0.24 : 0.14;
  const w = big ? 22 : 16;
  for (const s of hitSlashes) {
    s.style.left = `${-w / 2}px`;
    s.style.width = `${w}px`;
    s.style.background = color;
  }
}

function ensureHUD() {
  if (!hpLayer) {
    hpLayer = document.createElement("div");
    hpLayer.id = "gunHpLayer";
    hpLayer.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:76;overflow:hidden;font-family:var(--f-sans,system-ui,sans-serif)";
    document.body.appendChild(hpLayer);
  }

  if (!cross) {
    cross = document.createElement("div");
    cross.id = "gunCross";
    cross.style.cssText =
      "position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:80;display:none";

    // Center dot
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 4px #000";
    cross.appendChild(dot);

    // 4 dynamic crosshair bars (top, bottom, left, right)
    crossBars = [
      [0, -1, 2, 7],
      [0, 1, 2, 7],
      [-1, 0, 7, 2],
      [1, 0, 7, 2],
    ].map(([dx, dy, w, h]) => {
      const bar = document.createElement("div");
      bar.style.cssText = `position:absolute;width:${w}px;height:${h}px;background:#b6ffce;border-radius:1px;box-shadow:0 0 3px rgba(0,0,0,.85);transform:translate(-50%,-50%)`;
      cross.appendChild(bar);
      return { bar, dx, dy, w, h };
    });

    // Diagonal 'X' hitmarker on target hit
    hitMark = document.createElement("div");
    hitMark.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;opacity:0;transition:opacity 60ms";
    hitSlashes = [45, -45].map((deg) => {
      const slash = document.createElement("div");
      slash.style.cssText = `position:absolute;left:-9px;top:-1px;width:18px;height:2px;background:#ff4d4f;box-shadow:0 0 4px #000;transform:rotate(${deg}deg)`;
      hitMark.appendChild(slash);
      return slash;
    });
    cross.appendChild(hitMark);

    // Reload progress pill right below the crosshair
    reloadPillEl = document.createElement("div");
    reloadPillEl.style.cssText =
      "position:absolute;left:0;top:24px;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:3px;padding:3px 8px 4px;border-radius:6px;background:rgba(14,18,24,0.82);border:1px solid rgba(255,255,255,0.16);white-space:nowrap";
    const rTxt = document.createElement("span");
    rTxt.textContent = "RELOADING";
    rTxt.style.cssText =
      "font:700 9px/1 var(--f-mono,monospace);letter-spacing:0.1em;color:#f2c94c";
    const rTrack = document.createElement("div");
    rTrack.style.cssText =
      "width:48px;height:4px;border-radius:99px;background:rgba(255,255,255,0.15);overflow:hidden";
    reloadFillEl = document.createElement("div");
    reloadFillEl.style.cssText =
      "width:0%;height:100%;background:#f2c94c;border-radius:99px";
    rTrack.appendChild(reloadFillEl);
    reloadPillEl.append(rTxt, rTrack);
    cross.appendChild(reloadPillEl);

    document.body.appendChild(cross);
  }

  if (!hudEl) {
    hudEl = document.createElement("div");
    hudEl.id = "gunHud";
    hudEl.style.cssText =
      "position:fixed;right:20px;bottom:calc(24px + env(safe-area-inset-bottom,0px));display:none;flex-direction:column;align-items:flex-end;gap:8px;z-index:75;pointer-events:none;font-family:var(--f-sans,system-ui,sans-serif)";

    // Live Magazine / Unlimited Reserve Ammo Counter Card
    ammoPanelEl = document.createElement("div");
    ammoPanelEl.style.cssText =
      "display:flex;align-items:baseline;gap:8px;padding:7px 14px;border-radius:12px;background:rgba(14,18,24,0.82);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.15);box-shadow:0 4px 12px rgba(0,0,0,0.3)";
    ammoNumEl = document.createElement("span");
    ammoNumEl.style.cssText =
      "font:800 22px/1 var(--f-mono,monospace);color:#ffffff;font-variant-numeric:tabular-nums";
    ammoSubEl = document.createElement("span");
    ammoSubEl.style.cssText =
      "font:600 11px/1 var(--f-mono,monospace);color:#94a3b8";
    ammoPanelEl.append(ammoNumEl, ammoSubEl);
    hudEl.appendChild(ammoPanelEl);

    const slotsRow = document.createElement("div");
    slotsRow.style.cssText = "display:flex;gap:6px";
    hudSlots = GUNS.map((g, idx) => {
      const item = document.createElement("div");
      item.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(18,22,28,0.72);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);color:#cfd8e3;font-size:12px;font-weight:600;transition:transform 120ms,border-color 120ms,background 120ms";
      const magSpan = document.createElement("span");
      magSpan.style.cssText =
        "font:600 10px var(--f-mono,monospace);opacity:0.75";
      magSpan.textContent = `${g.mag}/${g.mag}`;
      item.innerHTML = `<span style="display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:rgba(255,255,255,0.12);font:700 10px var(--f-mono,monospace);color:${g.hex}">${idx + 1}</span><span>${g.name}</span>`;
      item.appendChild(magSpan);
      slotsRow.appendChild(item);
      return { item, magSpan };
    });
    hudEl.appendChild(slotsRow);
    document.body.appendChild(hudEl);
  }

  if (!boardEl) {
    boardEl = document.createElement("div");
    boardEl.id = "killBoard";
    boardEl.style.cssText =
      "position:fixed;top:calc(16px + env(safe-area-inset-top,0px));right:16px;width:190px;padding:8px 10px;border-radius:10px;background:rgba(14,18,24,0.56);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.12);color:#e2e8f0;font-family:var(--f-sans,system-ui,sans-serif);z-index:75;pointer-events:none;display:none;flex-direction:column;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.22)";
    const title = document.createElement("div");
    title.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;font:700 9.5px/1 var(--f-mono,monospace);letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.08)";
    title.innerHTML = `<span>Top 10 Killers</span><span style="color:#f2c94c">KO</span>`;
    boardListEl = document.createElement("div");
    boardListEl.style.cssText = "display:flex;flex-direction:column;gap:2px";
    boardEl.append(title, boardListEl);
    document.body.appendChild(boardEl);
  }
}

function renderKillBoard() {
  if (!boardListEl) return;
  const meKey = killerKey(player.person);
  if (!killCounts.has(meKey)) {
    killCounts.set(meKey, { name: meKey, kills: 0, t: 0 });
  }
  for (const p of people) {
    const k = killerKey(p);
    if (!killCounts.has(k)) killCounts.set(k, { name: k, kills: 0, t: 0 });
  }
  const ranked = [...killCounts.values()]
    .sort(
      (a, b) =>
        b.kills - a.kills ||
        b.t - a.t ||
        (a.name === meKey
          ? -1
          : b.name === meKey
            ? 1
            : a.name.localeCompare(b.name)),
    )
    .slice(0, 10);

  boardListEl.innerHTML = ranked
    .map((r, i) => {
      const rank = i + 1;
      const isMe = r.name === meKey;
      const rankCol =
        rank === 1
          ? "#f2c94c"
          : rank === 2
            ? "#cbd5e1"
            : rank === 3
              ? "#f59e0b"
              : "#64748b";
      const parts = r.name.split(" ");
      const shortName =
        parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : r.name;
      const rowBg = isMe ? "rgba(56,189,248,0.18)" : "transparent";
      const nameCol = isMe ? "#7dd8ff" : r.kills > 0 ? "#f1f5f9" : "#94a3b8";
      const countCol = r.kills > 0 ? "#ffffff" : "#64748b";
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 5px;border-radius:5px;background:${rowBg};font-size:11px;line-height:1.25">
        <div style="display:flex;align-items:center;gap:6px;min-width:0">
          <span style="width:14px;font:700 10px var(--f-mono,monospace);color:${rankCol};text-align:right">${rank}</span>
          <span style="font-weight:${isMe || r.kills > 0 ? 600 : 500};color:${nameCol};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:118px">${shortName}</span>
        </div>
        <span style="font:700 10.5px var(--f-mono,monospace);color:${countCol};font-variant-numeric:tabular-nums">${r.kills}</span>
      </div>`;
    })
    .join("");
}

function getHpCard(p) {
  let card = hpCards.get(p);
  if (card) return card;
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;left:0;top:0;width:86px;transform:translate(-50%,-100%);pointer-events:none;display:none;flex-direction:column;gap:3px;padding:4px 6px 5px;border-radius:8px;background:rgba(15,20,26,0.82);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.16);box-shadow:0 2px 8px rgba(0,0,0,0.45)";

  const top = document.createElement("div");
  top.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:700;line-height:1;color:#f1f5f9";
  const nameEl = document.createElement("span");
  nameEl.style.cssText =
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52px";
  nameEl.textContent = (p.name || "Staff").split(" ")[0];
  const valEl = document.createElement("span");
  valEl.style.cssText = "font-family:var(--f-mono,monospace);font-size:9.5px";
  top.append(nameEl, valEl);

  const track = document.createElement("div");
  track.style.cssText =
    "position:relative;width:100%;height:6px;border-radius:99px;background:rgba(255,255,255,0.12);overflow:hidden";
  const lagBar = document.createElement("div");
  lagBar.style.cssText =
    "position:absolute;left:0;top:0;bottom:0;width:100%;background:#ffffff;border-radius:99px;opacity:0.85";
  const fillBar = document.createElement("div");
  fillBar.style.cssText =
    "position:absolute;left:0;top:0;bottom:0;width:100%;background:#39d353;border-radius:99px";
  track.append(lagBar, fillBar);

  root.append(top, track);
  hpLayer.appendChild(root);
  card = { root, nameEl, valEl, lagBar, fillBar };
  hpCards.set(p, card);
  return card;
}

function updateHealthBars(dt, active) {
  ensureHUD();
  const w = innerWidth,
    h = innerHeight;
  camera.getWorldPosition(_a);

  for (const p of people) {
    if (p.hp == null) {
      p.hp = MAX_HP;
      p.hpLag = MAX_HP;
    }
    if (p.flinch > 0) p.flinch = Math.max(0, p.flinch - dt * 5.5);

    if (p.down > 0) {
      p.down = Math.max(0, p.down - dt);
      p.hpLag += (0 - p.hpLag) * Math.min(1, dt * 10);
      if (p.down === 0 && p.wasDown) {
        // Stand back up after 2 seconds with full HP!
        p.wasDown = false;
        p.hp = MAX_HP;
        p.hpLag = MAX_HP;
        p.hpShowT = 1.1;
      }
    } else {
      if (p.hurtCd > 0) p.hurtCd = Math.max(0, p.hurtCd - dt);
      else if (p.hp < MAX_HP) {
        p.hp = Math.min(MAX_HP, p.hp + REGEN_RATE * dt);
        if (p.hp >= MAX_HP) p.hpShowT = 1.0;
      }
      if (p.hpShowT > 0) p.hpShowT = Math.max(0, p.hpShowT - dt);
      p.hpLag += (p.hp - p.hpLag) * Math.min(1, dt * 7.5);
    }

    const isTarget = active && ctl.active && p === aimedPerson;
    const showBar =
      p !== player.person &&
      p.state !== "away" &&
      (p.down > 0 || p.hp < MAX_HP || p.hpShowT > 0 || isTarget);

    const card = hpCards.get(p);
    if (!showBar) {
      if (card) card.root.style.display = "none";
      continue;
    }

    const c = card || getHpCard(p);
    const headY = p.down > 0 ? 0.55 : (p.body?.eyeY || 1.42) + 0.34;
    _b.set(p.pos.x, (p.pos.y || 0) + headY, p.pos.z);
    const dist = _a.distanceTo(_b);
    _b.project(camera);

    if (_b.z > 1 || _b.z < -1 || dist > 16) {
      c.root.style.display = "none";
      continue;
    }

    const sx = (_b.x * 0.5 + 0.5) * w,
      sy = (-_b.y * 0.5 + 0.5) * h;
    c.root.style.display = "flex";
    c.root.style.left = `${sx.toFixed(1)}px`;
    c.root.style.top = `${sy.toFixed(1)}px`;
    const fade =
      p.down <= 0 && p.hp >= MAX_HP && !isTarget
        ? Math.min(1, p.hpShowT * 1.4)
        : 1;
    c.root.style.opacity = fade.toFixed(2);
    c.root.style.borderColor =
      p.down > 0
        ? "rgba(255,77,79,0.65)"
        : isTarget
          ? "rgba(255,255,255,0.42)"
          : "rgba(255,255,255,0.16)";

    if (p.down > 0) {
      const recPct = Math.max(0, Math.min(100, ((DOWN - p.down) / DOWN) * 100));
      c.valEl.textContent = `KO ${p.down.toFixed(1)}s`;
      c.valEl.style.color = "#ff6b6b";
      c.lagBar.style.width = "0%";
      c.fillBar.style.width = `${recPct.toFixed(1)}%`;
      c.fillBar.style.background = "#38bdf8";
    } else {
      const pct = Math.max(0, Math.min(100, (p.hp / MAX_HP) * 100));
      const lagPct = Math.max(pct, Math.min(100, (p.hpLag / MAX_HP) * 100));
      c.valEl.textContent = `${Math.ceil(p.hp)}`;
      const barCol = pct > 60 ? "#39d353" : pct > 30 ? "#f59e0b" : "#ef4444";
      c.valEl.style.color = barCol;
      c.lagBar.style.width = `${lagPct.toFixed(1)}%`;
      c.fillBar.style.width = `${pct.toFixed(1)}%`;
      c.fillBar.style.background = barCol;
    }
  }

  // Update floating 3D damage/KO popups
  for (let i = popups.length - 1; i >= 0; i--) {
    const pop = popups[i];
    pop.life -= dt;
    pop.y += pop.vy * dt;
    pop.vy *= Math.exp(-dt * 3);
    if (pop.life <= 0) {
      pop.el.remove();
      popups.splice(i, 1);
      continue;
    }
    _b.set(pop.x, pop.y, pop.z).project(camera);
    if (_b.z > 1 || _b.z < -1) {
      pop.el.style.display = "none";
      continue;
    }
    pop.el.style.display = "block";
    const sx = (_b.x * 0.5 + 0.5) * w,
      sy = (-_b.y * 0.5 + 0.5) * h;
    const sc =
      pop.life > pop.max * 0.75
        ? 1 + ((pop.max - pop.life) / (pop.max * 0.25)) * 0.25
        : 1;
    pop.el.style.left = `${sx.toFixed(1)}px`;
    pop.el.style.top = `${sy.toFixed(1)}px`;
    pop.el.style.opacity = Math.min(1, pop.life / 0.2).toFixed(2);
    pop.el.style.transform = `translate(-50%,-50%) scale(${sc.toFixed(2)})`;
  }
}

/* ================= Per-Frame Update ================= */
function updateGuns(dt) {
  animClock += dt;
  if (cd > 0) cd = Math.max(0, cd - dt);

  if (!armed) {
    aiming = false;
    firingHeld = false;
    ads = 0;
    savedFov = null;
  }

  const active = armedNow();
  // Step active reload timer
  if (reloadLeft > 0) {
    reloadLeft = Math.max(0, reloadLeft - dt);
    if (reloadLeft === 0 && player.gun != null) {
      ammo[player.gun] = GUNS[player.gun].mag;
      playGunSound("reloadDone");
    }
  }
  // Hold left mouse button to auto-fire when pointer-locked
  if (
    active &&
    firingHeld &&
    document.pointerLockElement &&
    cd <= 0 &&
    reloadLeft <= 0
  ) {
    fire();
  }

  // Smooth Aim-Down-Sights (ADS) blend + camera zoom
  const wantAds = aiming && active ? 1 : 0;
  if (wantAds && savedFov == null) savedFov = camera.fov;
  ads += (wantAds - ads) * Math.min(1, dt * 15);
  if (savedFov != null) {
    camera.fov = savedFov * (1 - 0.36 * ads);
    camera.updateProjectionMatrix();
    if (ads < 0.002 && !wantAds) {
      camera.fov = savedFov;
      camera.updateProjectionMatrix();
      savedFov = null;
    }
  }

  // Decay FPS procedural springs (equip, recoil, sway, jump/land dip, sprint)
  equipT = Math.max(0, equipT - dt * 4.5);
  const recDecay = Math.exp(-dt * 14);
  recZ *= recDecay;
  recPitch *= recDecay;
  recRoll *= recDecay;

  if (ctl.active) {
    const dyaw = lastYaw == null ? 0 : ctl.yaw - lastYaw,
      dpitch = lastPitch == null ? 0 : ctl.pitch - lastPitch;
    lastYaw = ctl.yaw;
    lastPitch = ctl.pitch;
    swayX +=
      (Math.max(-0.04, Math.min(0.04, -dyaw * 0.45)) - swayX) *
      Math.min(1, dt * 12);
    swayY +=
      (Math.max(-0.04, Math.min(0.04, -dpitch * 0.45)) - swayY) *
      Math.min(1, dt * 12);
  } else {
    lastYaw = lastPitch = null;
    swayX = swayY = 0;
  }

  if (player.moving && !player.air) {
    bobPhase += dt * (keys.has("shift") ? 13.5 : 8.5);
  } else {
    bobPhase += dt * 1.5;
  }

  const wantSprint =
    active &&
    player.moving &&
    keys.has("shift") &&
    !aiming &&
    !firingHeld &&
    recZ < 0.008
      ? 1
      : 0;
  sprintBlend += (wantSprint - sprintBlend) * Math.min(1, dt * 10);

  // Jump takeoff & landing dip impulse
  if (player.air && !wasAir) dipVel -= 0.32;
  else if (!player.air && wasAir) dipVel -= 0.48;
  wasAir = !!player.air;
  dipVel += (-dipY * 110 - dipVel * 14) * dt;
  dipY = Math.max(-0.045, Math.min(0.035, dipY + dipVel * dt));

  // Update dynamic crosshair & weapon HUD
  ensureHUD();
  const baseCross = $("crosshair");
  if (active && ctl.active) {
    if (baseCross) baseCross.hidden = true;
    cross.style.display = "block";
    const def = GUNS[player.gun];
    const spreadPx =
      (7 + (player.moving ? 4 : 0) + (player.air ? 5 : 0) + recZ * 180) *
      (1 - ads * 0.65);
    for (const b of crossBars) {
      b.bar.style.background = def.hex;
      b.bar.style.left = `${b.dx * spreadPx}px`;
      b.bar.style.top = `${b.dy * spreadPx}px`;
    }
    if (hitMarkT > 0) {
      hitMarkT = Math.max(0, hitMarkT - dt);
      hitMark.style.opacity = "1";
    } else {
      hitMark.style.opacity = "0";
    }
    if (reloadPillEl) {
      if (reloadLeft > 0 && reloadDur > 0) {
        reloadPillEl.style.display = "flex";
        const pct = Math.max(
          0,
          Math.min(100, ((reloadDur - reloadLeft) / reloadDur) * 100),
        );
        reloadFillEl.style.width = `${pct.toFixed(1)}%`;
      } else {
        reloadPillEl.style.display = "none";
      }
    }

    hudEl.style.display = "flex";
    const curAmmo = ammo[player.gun] ?? def.mag;
    const isLow = curAmmo <= Math.ceil(def.mag * 0.25);
    if (ammoNumEl && ammoSubEl) {
      if (reloadLeft > 0) {
        ammoNumEl.textContent = "RELOADING";
        ammoNumEl.style.fontSize = "14px";
        ammoNumEl.style.color = "#f2c94c";
        ammoSubEl.textContent = `${reloadLeft.toFixed(1)}s`;
      } else {
        ammoNumEl.textContent = `${curAmmo}`;
        ammoNumEl.style.fontSize = "22px";
        ammoNumEl.style.color = isLow ? "#ff6b6b" : def.hex;
        ammoSubEl.textContent = `/ ${def.mag} · ∞ ${curAmmo < def.mag ? "[R] Reload" : ""}`;
      }
    }
    for (let i = 0; i < hudSlots.length; i++) {
      const on = i === player.gun;
      const { item, magSpan } = hudSlots[i];
      magSpan.textContent = `${ammo[i]}/${GUNS[i].mag}`;
      item.style.borderColor = on ? GUNS[i].hex : "rgba(255,255,255,0.12)";
      item.style.background = on
        ? "rgba(24,32,42,0.92)"
        : "rgba(18,22,28,0.65)";
      item.style.transform = on ? "translateY(-3px) scale(1.03)" : "none";
      item.style.color = on ? "#ffffff" : "#9aa6b2";
    }
    if (boardEl) {
      boardEl.style.display = "flex";
      const curKey = `${killerKey(player.person)}:${people.length}`;
      if (boardDirty || curKey !== lastControlledKey) {
        lastControlledKey = curKey;
        boardDirty = false;
        renderKillBoard();
      }
    }
  } else {
    if (cross) cross.style.display = "none";
    if (hudEl) hudEl.style.display = "none";
    if (boardEl) boardEl.style.display = "none";
    if (baseCross && ctl.active) baseCross.hidden = false;
  }

  // Sync gun viewmodel / third-person hand transform
  if (active) aimPoint(_c);
  else aimedPerson = null;
  syncGun(dt);
  updateHealthBars(dt, active);

  // Muzzle point-light decay
  if (muzzleLightT > 0) {
    muzzleLightT = Math.max(0, muzzleLightT - dt);
    muzzleLight.intensity = (muzzleLightT / 0.06) * 2.6;
  } else muzzleLight.intensity = 0;

  // Step active projectiles
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.vy -= s.grav * dt;
    const nx = s.m.position.x + s.vx * dt,
      ny = s.m.position.y + s.vy * dt,
      nz = s.m.position.z + s.vz * dt;
    s.m.position.set(nx, ny, nz);
    s.life -= dt;
    s.trailT -= dt;

    if (s.kind === "bolt") {
      s.m.scale.set(
        s.size * (0.65 + Math.random() * 0.5),
        s.size * (0.65 + Math.random() * 0.5),
        s.size * 2.8,
      );
    } else if (s.kind === "fire") {
      s.m.scale.setScalar(s.size * (0.9 + Math.sin(s.life * 45) * 0.25));
    } else if (s.kind === "ball") {
      s.m.rotation.x += 12 * dt;
      s.m.rotation.y += 9 * dt;
    } else if (s.kind === "goo") {
      const sq = 1 + Math.sin(s.life * 32) * 0.22;
      s.m.scale.set(s.size * sq, s.size / sq, s.size * sq);
    }

    // Spawn glowing trail particles in flight
    if (s.trailT <= 0 && splatGeo) {
      s.trailT = 0.022;
      const tr = new THREE.Mesh(splatGeo, glowMat(s.hex, 0.9));
      tr.scale.setScalar(s.size * 0.35);
      tr.position.set(nx, ny, nz);
      scene.add(tr);
      splats.push({
        m: tr,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        vz: (Math.random() - 0.5) * 0.3,
        life: 0.14,
      });
    }

    let dead = s.life <= 0,
      hitPerson = null;

    // Floor bounce or impact
    if (!dead && ny <= 0.02) {
      if (s.bounces > 0) {
        s.bounces--;
        s.m.position.y = 0.03;
        s.vy = Math.abs(s.vy) * 0.68;
        s.vx *= 0.82;
        s.vz *= 0.82;
        splat(nx, 0.03, nz, false, s.hex);
        if (s.kind === "goo") stain(nx, nz, GREEN, 0.18);
      } else {
        dead = true;
      }
    }

    // Wall / furniture bounce or impact
    if (!dead && !walkPxAt(nx / S + OX, nz / S + OY, ny)) {
      if (s.bounces > 0 && s.kind === "goo") {
        s.bounces--;
        s.vx = -s.vx * 0.65;
        s.vz = -s.vz * 0.65;
        splat(nx, ny, nz, false, s.hex);
      } else {
        dead = true;
      }
    }

    // Person hit check (ignore knocked-out characters so shots pass cleanly through)
    if (!dead) {
      for (const q of people) {
        if (q === player.person || q.state === "away" || isKnockedOut(q))
          continue;
        if (hitY(q, ny) && Math.hypot(nx - q.pos.x, nz - q.pos.z) < 0.32) {
          hitPerson = q;
          dead = true;
          break;
        }
      }
    }

    if (dead) {
      onProjectileImpact(s, nx, Math.max(0.03, ny), nz, hitPerson);
      scene.remove(s.m);
      shots.splice(i, 1);
    }
  }

  // Step muzzle flashes
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.life -= dt;
    f.m.scale.setScalar(0.6 + (f.life / 0.055) * 0.8);
    if (f.life <= 0) {
      scene.remove(f.m);
      flashes.splice(i, 1);
    }
  }

  // Step laser/lightning beams
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.life -= dt;
    const r = Math.max(0, b.life / b.max);
    b.m.scale.set(r, r, 1);
    if (b.life <= 0) {
      scene.remove(b.m);
      b.m.geometry.dispose();
      beams.splice(i, 1);
    }
  }

  // Step expanding impact shockwave rings
  for (let i = rings.length - 1; i >= 0; i--) {
    const rg = rings[i];
    rg.life -= dt;
    const p = 1 - Math.max(0, rg.life / rg.max);
    rg.m.scale.setScalar(0.3 + p * rg.maxScale);
    rg.m.material.opacity = (1 - p) * 0.85;
    if (rg.life <= 0) {
      scene.remove(rg.m);
      rg.m.material.dispose();
      rings.splice(i, 1);
    }
  }

  // Step ejected shells
  for (let i = shells.length - 1; i >= 0; i--) {
    const sh = shells[i];
    sh.vy -= 9.8 * dt;
    sh.m.position.x += sh.vx * dt;
    sh.m.position.y += sh.vy * dt;
    sh.m.position.z += sh.vz * dt;
    if (sh.m.position.y < 0.015) {
      sh.m.position.y = 0.015;
      sh.vy = Math.abs(sh.vy) * 0.45;
      sh.vx *= 0.7;
      sh.vz *= 0.7;
    }
    sh.m.rotation.x += sh.rx * dt;
    sh.m.rotation.z += sh.rz * dt;
    sh.life -= dt;
    if (sh.life <= 0) {
      scene.remove(sh.m);
      shells.splice(i, 1);
    }
  }

  // Step splat droplets
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    s.vy -= 7.5 * dt;
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

  // Step floor stains
  for (let i = stains.length - 1; i >= 0; i--) {
    const s = stains[i];
    s.life -= dt;
    s.m.material.opacity = Math.min(0.72, s.life);
    if (s.life <= 0) {
      scene.remove(s.m);
      s.m.material.dispose();
      stains.splice(i, 1);
    }
  }
}

export {
  fire,
  gunDown,
  GUNS,
  gunsShow,
  gunUp,
  recordKill,
  reloadGun,
  selectGun,
  updateGuns,
};
