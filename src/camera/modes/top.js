import { camGoal, fitDist, orbitStep } from '../state.js';

// Plan view from straight above.
const topMode = {
  id: 'top',
  enter() {
    Object.assign(camGoal, { yaw: 0, pitch: 1.48 }); camGoal.dist = fitDist(1.48);
    camGoal.target.set(innerWidth > 760 ? -1.8 : 0, 0, innerWidth > 760 ? 0.6 : -5);
  },
  update(dt) { orbitStep(dt, 7); },
};

export { topMode };
