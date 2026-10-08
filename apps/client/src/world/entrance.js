import { W } from '@office/shared';
import { N, mkSpot } from './furniture/basics.js';

let EXIT, ENTRY;

function buildEntrance() {
  EXIT = mkSpot('exit', 223.5, 420, N, { shared: false, place: 'the exit' });
  ENTRY = W(223.5, 420);
}

export { ENTRY, EXIT, buildEntrance };
