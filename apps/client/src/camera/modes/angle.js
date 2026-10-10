import { camGoal, fitDist, orbitStep } from '../state.js';

// Overview from an angle.
const angleMode = {
  id: 'angle',
  enter() {
    Object.assign(camGoal, { yaw: .55, pitch: .92 }); camGoal.dist = fitDist(.92);
    camGoal.target.set(innerWidth > 760 ? -1.5 : 0, 0, innerWidth > 760 ? 3.2 : -1.8);
  },
  update(dt) { orbitStep(dt, 7); },
};

export { angleMode };
