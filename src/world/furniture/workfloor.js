import { E, WST } from './basics.js';
import { tv } from './tv.js';


function buildWorkfloor() {
  
  // TVs along the work floor
  tv(661.7, 367.9, 675.0, 432.4, WST, 'dash');
  tv(661.7, 700.1, 675.0, 769.5, WST, 'dash');
  tv(360.1, 797.3, 373.4, 840.6, E, 'slides');
}

export { buildWorkfloor };
