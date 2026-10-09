import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { objects, simEvents } from '@office/shared';
import { M } from './materials.js';
import { scene } from './renderer.js';
import { barStool, officeChair, woodChair } from '../world/furniture/basics.js';
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
  'plant-desk:0': g => {
    cyl(g, .06, .05, .1, M.pot, 0, .05, 0, 10);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), M.leaf); leaf.position.set(0, .16, 0); g.add(leaf); // (casts no shadow, as before)
  },
};
M.notebook.forEach((mat, i) => { PREFABS[`notebook:${i}`] = g => { box(g, .2, .025, .27, mat, 0, .015, 0, false); }; });

const key = o => `${o.type}:${o.variant}`;
const keep = ['position', 'normal', 'uv'];

/** One kind of object: a list of parts (a merged geometry in a material, drawn instanced) and which instance is which object. */
function makeKind(k) {
  const build = PREFABS[k];
  if (!build) throw new Error(`no drawing for object kind "${k}"`);
  const g = new THREE.Group(); build(g); g.updateMatrixWorld(true);
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

function write(kind, slot, o) {
  scratch.makeRotationY(o.rot).setPosition(o.x, o.y, o.z);
  for (const p of kind.parts) { p.mesh.setMatrixAt(slot, scratch); p.mesh.instanceMatrix.needsUpdate = true; }
}

/** Start drawing an object (it must have a kind this file knows how to draw). Grows the buffers when they are full: rare, not per frame. */
function add(o) {
  const k = key(o);
  let kind = kinds.get(k);
  if (!kind) { kind = makeKind(k); kinds.set(k, kind); }
  if (kind.count === kind.capacity) allocate(kind, Math.max(8, kind.capacity * 2));
  const slot = kind.count++;
  for (const p of kind.parts) p.mesh.count = kind.count;
  slotOf.set(o.index, { kind, slot });
  write(kind, slot, o);
}

/** Draw every object the world has, and keep each where the simulation says it is. */
export function initObjectViews() {
  for (const o of objects.all()) add(o);
  simEvents.on('objectMoved', o => { const s = slotOf.get(o.index); if (s) write(s.kind, s.slot, o); });
}

/** Draw objects made after the start (the stress check adds many). */
export const addObjectView = add;

/** How many draw calls the objects cost: the parts of the kinds in use. */
export const objectDrawCalls = () => { let n = 0; for (const k of kinds.values()) n += k.parts.length; return n; };
