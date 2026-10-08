import * as THREE from 'three';
import { M } from '../render/materials.js';
import { boxGeo } from '../world/helpers.js';

// Props that a character holds. Shared by the rig (carried) and the world (the guitar on its stand).
function makeGuitar() {
  const g = new THREE.Group();
  const bodyM = M.guitarBody, darkM = M.chairBase;
  const lower = new THREE.Mesh(new THREE.SphereGeometry(.19, 18, 12), bodyM); lower.scale.set(1, .85, .28); lower.position.x = -.06; lower.castShadow = true; g.add(lower);
  const upper = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 10), bodyM); upper.scale.set(1, .85, .28); upper.position.x = .15; upper.castShadow = true; g.add(upper);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(.05, 16), darkM); hole.position.set(.06, 0, .056); g.add(hole);
  const bridge = new THREE.Mesh(boxGeo(.03, .1, .015), darkM); bridge.position.set(-.1, 0, .055); g.add(bridge);
  const neck = new THREE.Mesh(boxGeo(.46, .05, .025), M.diningWood2); neck.position.set(.5, 0, .03); g.add(neck);
  const headstock = new THREE.Mesh(boxGeo(.14, .07, .02), darkM); headstock.position.set(.79, 0, .03); g.add(headstock);
  return g;
}

export { makeGuitar };
