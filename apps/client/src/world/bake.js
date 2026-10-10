import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../render/renderer.js';
import { STATIC_SHAPES, staticRoot } from './helpers.js';

const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// The solid shape of one baked part, for the server's physics: boxes, cylinders and spheres as they are drawn (anything else, such as
// leaves, bananas and flat floor planes, is decoration nobody puts things on). Parts thinner than half a centimetre are skipped.
function recordShape(m) {
  const p = m.geometry.parameters;
  if (!p) return;
  m.matrixWorld.decompose(_p, _q, _s);
  const at = [r3(_p.x), r3(_p.y), r3(_p.z)], q = Math.abs(_q.w) > .99999 ? undefined : [r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w)];
  let shape = null;
  if (m.geometry.type === 'BoxGeometry') {
    const size = [p.width * _s.x, p.height * _s.y, p.depth * _s.z];
    if (Math.min(...size) >= .005) shape = { s: 'b', size: size.map(r3), at };
  } else if (m.geometry.type === 'CylinderGeometry') {
    const r = Math.max(p.radiusTop, p.radiusBottom) * Math.max(_s.x, _s.z), h = p.height * _s.y;
    // (a turn about its own upright axis changes nothing, and plant pots get a random one per page: leave it out so the file is the same every time)
    if (r >= .005 && h >= .005) { shape = { s: 'c', r: r3(r), h: r3(h), at }; if (q && Math.hypot(_q.x, _q.z) < 1e-4) return STATIC_SHAPES.push(shape); }
  } else if (m.geometry.type === 'SphereGeometry') {
    shape = { s: 's', r: r3(p.radius * Math.max(_s.x, _s.y, _s.z)), at };
  }
  if (shape) { if (q && shape.s !== 's') shape.q = q; STATIC_SHAPES.push(shape); }
}

/** The baked meshes: what an aim at the fixed furniture (a desk, the counter) is tested against (net/objects.js). */
const BAKED = [];

/* Bake static furniture into a handful of draw calls */
function bake(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map(), kill = [];
  root.traverse(o => {
    if (!o.isMesh || o.userData.dynamic || Array.isArray(o.material)) return;
    recordShape(o);
    const k = o.material.uuid + (o.castShadow ? 'c' : 'n');
    if (!buckets.has(k)) buckets.set(k, { mat: o.material, cast: o.castShadow, geos: [] });
    const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    buckets.get(k).geos.push(g.index ? g : g); kill.push(o);
  });
  kill.forEach(o => o.parent.remove(o));
  for (const b of buckets.values()) {
    const indexed = b.geos.filter(g => g.index), flat = b.geos.filter(g => !g.index);
    for (const set of [indexed, flat]) {
      if (!set.length) continue;
      const merged = mergeGeometries(set, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.cast; m.receiveShadow = true; scene.add(m); BAKED.push(m);
    }
  }
}


function buildBake() {
  bake(staticRoot);
}

export { BAKED, buildBake };
