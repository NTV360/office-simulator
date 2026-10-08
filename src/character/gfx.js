import * as THREE from 'three';

// Shared, cached materials and geometry for building characters.
const matCache = new Map();
const stdMat = (hex, rough = .75) => { const k = hex + rough; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough })); return matCache.get(k); };
const capsCache = new Map();
function limb(r, len, mat) {
  const k = r + '_' + len; if (!capsCache.has(k)) capsCache.set(k, new THREE.CapsuleGeometry(r, Math.max(.01, len - 2 * r), 4, 10));
  const m = new THREE.Mesh(capsCache.get(k), mat); m.position.y = -len / 2; m.castShadow = true; return m;
}
const sph = (r, ws = 16, hs = 12) => { const k = 's' + r + ws; if (!capsCache.has(k)) capsCache.set(k, new THREE.SphereGeometry(r, ws, hs)); return capsCache.get(k); };
const eyeMat = stdMat('#1b1f24', .3);

export { eyeMat, limb, sph, stdMat };
