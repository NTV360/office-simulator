import { shuffle } from '@office/shared';
import { interactables } from '../world/interactables.js';

const people = [];

const CLOCK = 0.4; // sim minutes per real second at 1×
const sim = { t: 9 * 60 + 25, day: 1, speed: 1, paused: false, lastMinute: 0 };
const log = [];
function addLog(msg) { log.unshift({ t: sim.t, msg }); if (log.length > 5) log.pop(); logState.dirty = true; }
const logState = { dirty: true };

let deskPool;

function initState() {
  deskPool = shuffle(interactables.of('desk').slice());
}

export { CLOCK, addLog, deskPool, log, logState, people, sim, initState };
