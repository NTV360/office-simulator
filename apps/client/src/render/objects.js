import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CATALOGUE, S, objects, people, simEvents } from '@office/shared';
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
const carrierOf = new Map(); // object index -> the person id carrying it
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
  for (const p of kind.parts) { p.mesh.setMatrixAt(slot, scratch); p.mesh.instanceMatrix.needsUpdate = true; }
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
  write(kind, slot, o);
}

/** Draw every object the world has, and keep each where the simulation says it is. */
export function initObjectViews() {
  for (const o of objects.all()) add(o);
  simEvents.on('objectMoved', o => {
    const s = slotOf.get(o.index);
    if (!s) return;
    const before = carrierOf.get(o.index);
    if (before !== undefined && before !== o.carriedBy) { const q = people.find(x => x.id === before); if (q) q.carrying = false; }
    if (o.carriedBy !== null) { carried.set(o.index, o); carrierOf.set(o.index, o.carriedBy); updateCarriedObjects(); } // (drawn in the hands from the next frame on)
    else { carried.delete(o.index); carrierOf.delete(o.index); write(s.kind, s.slot, o); }
  });
}

/**
 * Objects somebody carries are drawn a step in front of them, at hand height, facing the way they face, and the carrier is told they carry
 * something (the page lifts their arms). Only these are touched each frame: usually none, never more than the people playing.
 */
export function updateCarriedObjects() {
  for (const o of carried.values()) {
    const p = people.find(x => x.id === o.carriedBy);
    const s = slotOf.get(o.index);
    if (!p || !s) continue;
    p.carrying = true;
    const floor = CATALOGUE[o.type]?.rests !== 'surface';
    write(s.kind, s.slot, { index: o.index, x: p.pos.x + Math.sin(p.face) * .55, y: floor ? .5 : .95, z: p.pos.z + Math.cos(p.face) * .55, rot: p.face });
  }
}

/** Draw objects made after the start (the stress check adds many). */
export const addObjectView = add;

/** How many draw calls the objects cost: the parts of the kinds in use. */
export const objectDrawCalls = () => { let n = 0; for (const k of kinds.values()) n += k.parts.length; return n; };
