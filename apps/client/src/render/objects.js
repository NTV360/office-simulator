import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, closestPointOnItem, objects, people, simEvents } from '@office/shared';
import { M } from './materials.js';
import { scene } from './renderer.js';
import { barStool, drawPlant, officeChair, woodChair } from '../world/furniture/basics.js';
import { drawBarTable } from '../world/furniture/bar.js';
import { drawCabinet } from '../world/furniture/cabinet.js';
import { drawGuitarStand, drawPiano, drawPianoStand, drawStoolLow } from '../world/furniture/music.js';
import { drawTvStand } from '../world/furniture/tv.js';
import { drawWhiteboard } from '../world/furniture/whiteboard.js';
import { drawApple, drawBananas, drawCoffeeMachine, drawFruitBowl, drawOrange } from '../world/furniture/kitchen.js';
import { drawTable } from '../world/furniture/conference.js';
import { drawConsole } from '../world/furniture/game.js';
import { drawSofa } from '../world/furniture/lounge.js';
import { box, cyl } from '../world/helpers.js';

// Drawing the movable objects (chairs, stools and the small things on desks), fast. Every kind of object is built once, from the same
// furniture code as before, merged into one geometry per material, and drawn with one InstancedMesh per material: a hundred chairs cost
// as many draw calls as one. Moving an object writes one matrix and flags the buffer; nothing is allocated per frame, nothing is
// created when something moves, and nothing here runs per frame at all. (Small things sit on y = 0 of their surface: their parts are
// built relative to the desk top, which the object's own `y` supplies.)

// What each kind (and colour) is made of. The parts are placed at the object's origin, facing "south" (rotation 0).
const PREFABS = {
  'chair-office:0': g => officeChair(g, M.chairSeat),
  'chair-office:1': g => officeChair(g, M.chairSeat2),
  'chair-wood:0': woodChair,
  'stool-bar:0': barStool,
  'mug:0': g => { cyl(g, .04, .035, .1, M.white, 0, .05, 0, 10); },
  // (the monitor's screen is not part of it: each one shows its own desk, so it is a mesh of its own, attached: see attachToObject)
  'monitor:0': g => { box(g, .22, .012, .16, M.monitor, 0, .006, 0); box(g, .05, .14, .04, M.monitor, 0, .08, .02); box(g, .58, .34, .03, M.monitor, 0, .27, 0); },
  'keyboard:0': g => { box(g, .4, .018, .13, M.keyboard, 0, .009, 0, false); },
  'cup:0': g => { cyl(g, .05, .04, .1, M.white, 0, .05, 0, 10, false); },
  // furniture that comes in sizes: `dims` is its size in plan pixels (shared/world/shapes.ts), one kind per size
  'table-dining:0': (g, [w, d]) => drawTable(g, w * S, d * S, M.diningWood, M.diningWood2, .74),
  'table-coffee:0': (g, [w, d]) => drawTable(g, w * S, d * S, M.diningWood, M.diningWood2, .42),
  'table-bar:0': (g, [w, d]) => drawBarTable(g, w * S, d * S),
  'sofa:0': (g, [l, d]) => drawSofa(g, l * S, d * S, false),
  'couch:0': (g, [l, d]) => drawSofa(g, l * S, d * S, false),
  'armchair:0': (g, [l, d]) => drawSofa(g, l * S, d * S, true),
  'plant-floor:0': (g, [big]) => drawPlant(g, big),
  'console:0': drawConsole,
  'credenza:0': (g, [w, d]) => drawCabinet(g, w, d, .85),
  'cabinet-tall:0': (g, [w, d]) => drawCabinet(g, w, d, 1.85),
  'coffee-machine:0': drawCoffeeMachine,
  'water-jug:0': g => { cyl(g, .13, .13, .4, M.waterBottle, 0, .2, 0, 16); },
  'toaster:0': g => { box(g, .4, .3, .3, M.steel, 0, .15, 0); },
  'cup-small:0': g => { cyl(g, .035, .03, .08, M.white, 0, .04, 0, 10, false); },
  'fruit-bowl:0': drawFruitBowl,
  'bananas:0': drawBananas,
  'apple:0': drawApple,
  'orange:0': drawOrange,
  'puck:0': g => { cyl(g, .07, .05, .05, M.dark, 0, .025, 0, 10); },
  'tv-stand:0': (g, [along]) => drawTvStand(g, Math.min(along * S, 2.1)),
  'whiteboard:0': g => drawWhiteboard(g, 0),
  'whiteboard:1': g => drawWhiteboard(g, 1),
  'piano-stand:0': drawPianoStand,
  'piano:0': drawPiano,
  'stool-low:0': g => drawStoolLow(g, false),
  'stool-low:1': g => drawStoolLow(g, true),
  'guitar-stand:0': drawGuitarStand,
  'mouse:0': g => { box(g, .05, .02, .08, M.keyboard, 0, .01, 0, false); },
  'plant-desk:0': g => {
    cyl(g, .06, .05, .1, M.pot, 0, .05, 0, 10);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), M.leaf); leaf.position.set(0, .16, 0); g.add(leaf); // (casts no shadow, as before)
  },
};
M.notebook.forEach((mat, i) => { PREFABS[`notebook:${i}`] = g => { box(g, .2, .025, .27, mat, 0, .015, 0, false); }; });

const key = o => `${o.type}:${o.variant}` + (o.dims ? ':' + o.dims.join(',') : '');
const keep = ['position', 'normal', 'uv'];

/** One kind of object: a list of parts (a merged geometry in a material, drawn instanced) and which instance is which object. */
function makeKind(k, o) {
  const build = PREFABS[`${o.type}:${o.variant}`];
  if (!build) throw new Error(`no drawing for object kind "${k}"`);
  const g = new THREE.Group(); build(g, o.dims ?? []); g.updateMatrixWorld(true);
  const byMat = new Map();
  g.traverse(m => {
    if (!m.isMesh) return;
    const id = m.material.uuid + (m.castShadow ? 'c' : 'n');
    if (!byMat.has(id)) byMat.set(id, { mat: m.material, cast: m.castShadow, geos: [] });
    const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
    for (const a of Object.keys(geo.attributes)) if (!keep.includes(a)) geo.deleteAttribute(a);
    byMat.get(id).geos.push(geo);
  });
  const parts = [];
  for (const b of byMat.values()) {
    const indexed = b.geos.filter(x => x.index), flat = b.geos.filter(x => !x.index);
    for (const set of [indexed, flat]) {
      if (!set.length) continue;
      const geometry = set.length === 1 ? set[0] : mergeGeometries(set, false);
      parts.push({ geometry, mat: b.mat, cast: b.cast, mesh: null });
    }
  }
  return { parts, capacity: 0, count: 0, slots: [] };
}

const kinds = new Map(); // key -> kind
const slotOf = new Map(); // object index -> { kind, slot }
const carried = new Map(); // object index -> the object, for those in somebody's hands (the only ones that are redrawn every frame)
const carrierOf = new Map(); // object index -> the ids of the people holding it
const scratch = new THREE.Matrix4();

function allocate(kind, capacity) {
  for (const p of kind.parts) {
    const old = p.mesh;
    const mesh = new THREE.InstancedMesh(p.geometry, p.mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // the instances are spread over the whole office: one bounding sphere would be the whole office anyway
    mesh.castShadow = p.cast; mesh.receiveShadow = true;
    mesh.count = kind.count;
    if (old) { mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, old.count * 16)); scene.remove(old); old.dispose(); }
    scene.add(mesh);
    p.mesh = mesh;
  }
  kind.capacity = capacity;
}

const tilt = new THREE.Quaternion(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
function write(kind, slot, o) {
  if (o.q) scratch.compose(at.set(o.x, o.y, o.z), tilt.set(o.q[0], o.q[1], o.q[2], o.q[3]), one); // (knocked over, or tilted)
  else scratch.makeRotationY(o.rot).setPosition(o.x, o.y, o.z);
  for (const p of kind.parts) { p.mesh.setMatrixAt(slot, scratch); p.mesh.instanceMatrix.needsUpdate = true; p.mesh.boundingSphere = null; } // (re-measured when next aimed at)
  const att = attached.get(o.index ?? -1);
  if (att) for (const a of att) a.mesh.matrix.multiplyMatrices(scratch, a.local);
}

// Meshes fixed to an object that are not part of its kind (a monitor's screen, which shows its own desk): object index -> [{ mesh, local }].
const attached = new Map();
/** Fix `mesh` to object `o`: its position and rotation now are where it sits on the object, in the object's own frame; it goes where the object goes. */
export function attachToObject(o, mesh) {
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.userData.dynamic = true;
  const list = attached.get(o.index) ?? [];
  list.push({ mesh, local: mesh.matrix.clone() });
  attached.set(o.index, list);
  scene.add(mesh);
}

/** Start drawing an object (it must have a kind this file knows how to draw). Grows the buffers when they are full: rare, not per frame. */
function add(o) {
  const k = key(o);
  let kind = kinds.get(k);
  if (!kind) { kind = makeKind(k, o); kinds.set(k, kind); }
  if (kind.count === kind.capacity) allocate(kind, Math.max(8, kind.capacity * 2));
  const slot = kind.count++;
  for (const p of kind.parts) p.mesh.count = kind.count;
  slotOf.set(o.index, { kind, slot });
  kind.slots[slot] = o.index;
  write(kind, slot, o);
}

// Where each moving item is drawn now. The server sends where things are about 20 times a second; drawn there at once, a carried chair or a
// falling mug would step. So it glides to each new place, quickly: index -> { pos, q }. Something that jumped far (put back where it started,
// a new page) is just put there.
const shown = new Map();
const gliding = new Set();
const UP = new THREE.Vector3(0, 1, 0), GLIDE = 18, JUMP = 1.5;
const poseOf = (o, pos, q) => { pos.set(o.x, o.y, o.z); return o.q ? q.set(o.q[0], o.q[1], o.q[2], o.q[3]) : q.setFromAxisAngle(UP, o.rot); };
function writeShown(index) {
  const s = slotOf.get(index), c = shown.get(index);
  if (!s || !c) return;
  scratch.compose(c.pos, c.q, one);
  for (const p of s.kind.parts) { p.mesh.setMatrixAt(s.slot, scratch); p.mesh.instanceMatrix.needsUpdate = true; p.mesh.boundingSphere = null; }
  const att = attached.get(index);
  if (att) for (const a of att) a.mesh.matrix.multiplyMatrices(scratch, a.local);
}
const want = new THREE.Vector3(), wantQ = new THREE.Quaternion();
function glideTo(o) {
  let c = shown.get(o.index);
  if (!c) { c = { pos: new THREE.Vector3(), q: new THREE.Quaternion() }; shown.set(o.index, c); poseOf(o, c.pos, c.q); writeShown(o.index); return; }
  poseOf(o, want, wantQ);
  // (nothing is gliding things along: offline, where nothing calls updateCarriedObjects. Put it there)
  if (c.pos.distanceTo(want) > JUMP || performance.now() - lastGlide > 200) { c.pos.copy(want); c.q.copy(wantQ); gliding.delete(o.index); writeShown(o.index); return; }
  gliding.add(o.index);
}
let lastGlide = -Infinity;

/** Draw every object the world has, and keep each where the simulation says it is. */
export function initObjectViews() {
  for (const o of objects.all()) add(o);
  for (const o of objects.all()) { const c = { pos: new THREE.Vector3(), q: new THREE.Quaternion() }; poseOf(o, c.pos, c.q); shown.set(o.index, c); }
  simEvents.on('objectMoved', o => {
    if (!slotOf.has(o.index)) return;
    // (everyone holding it holds their arms out to it; whoever has let go puts them down)
    const now = o.carriedBy === null ? [] : [o.carriedBy, ...o.helpers];
    for (const id of carrierOf.get(o.index) ?? []) if (!now.includes(id)) { const q = people.find(x => x.id === id); if (q) { q.carrying = false; q.carryAt = null; } }
    if (now.length) { carried.set(o.index, o); carrierOf.set(o.index, now); } else { carried.delete(o.index); carrierOf.delete(o.index); }
    glideTo(o);
  });
}

/**
 * Once a frame: what is moving glides on towards where it is, and whoever carries something holds their arms out to it (to the point of it
 * nearest their chest). Only moving and carried things are touched: usually none.
 */
export function updateCarriedObjects(dt = 1 / 60) {
  lastGlide = performance.now();
  const k = 1 - Math.exp(-dt * GLIDE);
  for (const index of gliding) {
    const o = objects.at(index), c = shown.get(index);
    if (!o || !c) { gliding.delete(index); continue; }
    poseOf(o, want, wantQ);
    c.pos.lerp(want, k); c.q.slerp(wantQ, k);
    if (c.pos.distanceToSquared(want) < 1e-8 && c.q.angleTo(wantQ) < 1e-4) { c.pos.copy(want); c.q.copy(wantQ); gliding.delete(index); }
    writeShown(index);
  }
  for (const o of carried.values()) for (const id of carrierOf.get(o.index) ?? []) {
    const p = people.find(x => x.id === id);
    if (!p) continue;
    p.carrying = true;
    p.carryAt = closestPointOnItem(o, { x: p.pos.x, y: 1.1, z: p.pos.z });
  }
}

/**
 * A see-through copy of an item, for showing where it would go (the ghost): its own shapes in one green or red glass. Made once per kind;
 * `ok` colours it. Returns a group to place and a function to colour it.
 */
const ghostGlass = { ok: new THREE.MeshBasicMaterial({ color: 0x55c27a, transparent: true, opacity: .38, depthWrite: false }), no: new THREE.MeshBasicMaterial({ color: 0xd66f5a, transparent: true, opacity: .38, depthWrite: false }) };
const ghosts = new Map();
export function ghostOf(o) {
  const k = key(o);
  let g = ghosts.get(k);
  if (!g) {
    const kind = kinds.get(k);
    if (!kind) return null;
    const group = new THREE.Group(), meshes = kind.parts.map(p => { const m = new THREE.Mesh(p.geometry, ghostGlass.ok); m.renderOrder = 4; group.add(m); return m; });
    group.visible = false; scene.add(group);
    g = { group, paint: ok => { for (const m of meshes) m.material = ok ? ghostGlass.ok : ghostGlass.no; } };
    ghosts.set(k, g);
  }
  return g;
}

/**
 * The item a ray hits first, and where: { index, point, distance }, or null. `skip` is an item to look through (the one in your hands).
 * Every kind's parts are tested; an instanced mesh tests each instance, so this is for a few times a second, not every frame.
 */
export function itemAt(raycaster, skip = -1) {
  let best = null;
  for (const kind of kinds.values()) for (const p of kind.parts) {
    if (!p.mesh) continue;
    for (const h of raycaster.intersectObject(p.mesh, false)) {
      const index = kind.slots[h.instanceId];
      if (index === undefined || index === skip) continue;
      if (!best || h.distance < best.distance) best = { index, point: h.point.clone(), distance: h.distance };
      break;
    }
  }
  return best;
}

/** Draw objects made after the start (the stress check adds many). */
export const addObjectView = add;

/** How many draw calls the objects cost: the parts of the kinds in use. */
export const objectDrawCalls = () => { let n = 0; for (const k of kinds.values()) n += k.parts.length; return n; };
