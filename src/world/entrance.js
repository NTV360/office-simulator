import { W } from '../config/plan.js';
import { N, mkSpot } from './furniture/basics.js';

const EXIT = mkSpot('exit', 223.5, 420, N, { shared: false, place: 'the exit' });
const ENTRY = W(223.5, 420);

export { ENTRY, EXIT };
