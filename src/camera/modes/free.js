import { orbitStep } from '../state.js';

// Manual orbit/pan/zoom: what you get after dragging, or after a jump-to.
const freeMode = {
  id: 'free',
  update(dt) { orbitStep(dt, 7); },
};

export { freeMode };
