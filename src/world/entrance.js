import { FRONT_Y, W } from '../config/plan.js';
import { N, mkSpot } from './furniture/basics.js';

let EXIT, ENTRY;

function buildEntrance() {
  EXIT = mkSpot('exit', 223.5, FRONT_Y + 31, N, { shared: false, place: 'the exit' });
  ENTRY = W(223.5, FRONT_Y + 31);
}

export { ENTRY, EXIT, buildEntrance };
