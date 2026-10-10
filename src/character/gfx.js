import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared, cached materials and geometry for characters: the props and face parts we add, and the
// draw-call merge applied to every character the pack builds.
const matCache = new Map();
const stdMat = (hex, rough = .75) => { const k = hex + rough; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough })); return matCache.get(k); };
const geoCache = new Map();
const sph = (r, ws = 16, hs = 12) => { const k = 's' + r + ws; if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, ws, hs)); return geoCache.get(k); };

// The pack gives every character its own materials, which differ almost only by colour. Characters share
// materials instead: one per surface kind with the colour stored in the geometry (vertex colours), and
// one per colour for skin and for glowing parts.
const sharedMats = new Map();
function shared(key, make) { if (!sharedMats.has(key)) sharedMats.set(key, make()); return sharedMats.get(key); }
const surfaceKey = m => [m.type, m.roughness, m.metalness, m.side, m.flatShading].join('|');
function bucketFor(m, skinHex) {
  const glows = m.emissiveIntensity > 0 && m.emissive.getHex() !== 0;
  if (glows || m.color.getHex() === skinHex) {
    const key = [surfaceKey(m), m.color.getHex(), glows ? m.emissive.getHex() : 0, m.emissiveIntensity].join('|');
    return { key, painted: false, mat: () => shared(key, () => m.clone()) };
  }
  const key = 'vc|' + surfaceKey(m);
  return { key, painted: true, mat: () => shared(key, () => { const c = m.clone(); c.color.set(0xffffff); c.vertexColors = true; return c; }) };
}

// Merge the meshes hanging directly off each joint into as few meshes as possible (usually one, plus skin),
// so a character costs about a dozen draw calls instead of about fifty. Joints still move: only meshes that
// share a joint are merged. Returns the new geometries (dispose them with the character).
function mergeJoints(root, skinHex) {
  const made = [], joints = [];
  root.traverse(o => { if (!o.isMesh) joints.push(o); });
  for (const joint of joints) {
    const buckets = new Map();
    for (const m of joint.children) {
      if (!m.isMesh || m.children.length || Array.isArray(m.material)) continue;
      const b = bucketFor(m.material, skinHex), key = b.key + (m.geometry.index ? 'i' : 'n');
      if (!buckets.has(key)) buckets.set(key, { ...b, meshes: [] });
      buckets.get(key).meshes.push(m);
    }
    for (const b of buckets.values()) {
      const geos = b.meshes.map(m => {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
        if (b.painted) {
          const { r, g: gr, b: bl } = m.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = gr; col[i * 3 + 2] = bl; }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        return g;
      });
      const geo = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
      if (!geo) continue; // incompatible geometry: leave these meshes as the pack made them
      const mesh = new THREE.Mesh(geo, b.mat()); mesh.castShadow = true; mesh.receiveShadow = true;
      b.meshes.forEach(m => joint.remove(m)); joint.add(mesh); made.push(geo);
    }
  }
  return made;
}

export { mergeJoints, sph, stdMat };
