import { mkSpot } from '@office/shared';
import { N } from './furniture/basics.js';

// The door people leave through. Where they arrive (ENTRY) is a plan constant in the shared package.
function buildEntrance() {
  mkSpot('exit', 223.5, 420, N, { shared: false, place: 'the exit' });
}

export { buildEntrance };
