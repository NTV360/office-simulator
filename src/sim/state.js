import * as THREE from 'three';
import { shuffle } from '../core/util.js';
import { scene } from '../render/renderer.js';
import { SEATS } from '../world/furniture/basics.js';

const people = [];
const peopleGroup = new THREE.Group(); scene.add(peopleGroup);
const deskPool = shuffle(SEATS.desk.slice());

const CLOCK = 0.4; // sim minutes per real second at 1×
const sim = { t: 9 * 60 + 25, day: 1, speed: 1, paused: false, lastMinute: 0 };
const log = [];
function addLog(msg) { log.unshift({ t: sim.t, msg }); if (log.length > 5) log.pop(); logDirty = true; }
let logDirty = true;

function setLogDirty(v) { logDirty = v; }

export { CLOCK, addLog, deskPool, log, logDirty, people, peopleGroup, sim, setLogDirty };
