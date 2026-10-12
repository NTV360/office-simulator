import * as THREE from 'three';
import { S } from '../../config/plan.js';
import { staticRoot } from '../helpers.js';
import { interactables } from '../interactables.js';
import { TETO_SEAT } from './desks.js';

// Frieren plush on Teto's desk, by her right hand, angled toward her.
// Model: public/models/lim/frieren/frieren_plush.glb (made with TRELLIS; face copied from the official front render).
const PLUSH_URL = 'models/lim/frieren/frieren_plush.glb';
const PLUSH_H = .29; // height on the desk (m)

function buildPlush() {
  const s = interactables.of('desk').find(q => q.deskId === TETO_SEAT); if (!s) return;
  const f = new THREE.Group(); f.position.copy(s.pos); f.rotation.y = s.face; staticRoot.add(f);
  // loads after the bake, so it stays its own mesh; the loader is fetched on demand to keep it out of the main bundle
  import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().load(import.meta.env.BASE_URL + PLUSH_URL, g => {
    const plush = g.scene;
    plush.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      // the texture has its lighting baked in, so let it glow a little instead of going dark under the office lights
      const m = o.material, map = m.map, face = m.transparent; // the face overlays carry their own transparency
      o.material = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : m.color, roughness: 1, emissive: map ? 0xffffff : m.color, emissiveMap: map, emissiveIntensity: .22,
        transparent: face, depthWrite: !face, alphaTest: face ? .02 : 0, polygonOffset: face, polygonOffsetFactor: -1 });
      if (face) o.renderOrder = 2; else { o.castShadow = true; o.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(plush), k = PLUSH_H / (box.max.y - box.min.y);
    plush.scale.setScalar(k); plush.position.set(-.44, .76 - box.min.y * k, 12.8 * S + .2); plush.rotation.y = Math.PI - .6;
    f.add(plush);
  }, undefined, e => console.warn('Frieren plush failed to load', e)));
}

export { buildPlush };
