import * as THREE from 'three';
import { scene } from '../render/renderer.js';

// Where the people's meshes live in the scene. Client-only: the simulation does not know about meshes.
const peopleGroup = new THREE.Group();

function initPeopleGroup() {
  scene.add(peopleGroup);
}

export { initPeopleGroup, peopleGroup };
