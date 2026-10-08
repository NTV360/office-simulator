import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from '../render/renderer.js';
import { staticRoot } from './helpers.js';

/* Bake static furniture into a handful of draw calls */
function bake(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map(), kill = [];
  root.traverse(o => {
    if (!o.isMesh || o.userData.dynamic || Array.isArray(o.material)) return;
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
      const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.cast; m.receiveShadow = true; scene.add(m);
    }
  }
}


function buildBake() {
  bake(staticRoot);
}

export { buildBake };
