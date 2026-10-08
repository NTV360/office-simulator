import * as THREE from 'three';
import { shuffle } from '../core/util.js';
import { scene } from '../render/renderer.js';
import { interactables } from '../world/interactables.js';

const people = [];
const peopleGroup = new THREE.Group();

const CLOCK = 0.4; // sim minutes per real second at 1×
const sim = { t: 9 * 60 + 25, day: 1, speed: 1, paused: false, lastMinute: 0 };
const log = [];
function addLog(msg) { log.unshift({ t: sim.t, msg }); if (log.length > 5) log.pop(); logState.dirty = true; }
const logState = { dirty: true };

let deskPool;

function initState() {
  scene.add(peopleGroup);
  deskPool = shuffle(interactables.of('desk').slice());
}

export { CLOCK, addLog, deskPool, log, logState, people, peopleGroup, sim, initState };
