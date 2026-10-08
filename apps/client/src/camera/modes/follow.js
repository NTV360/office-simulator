import { isStaff, people, vpick } from '@office/shared';
import { select, selected } from '../../ui/person.js';
import { camGoal, orbitStep } from '../state.js';

// Orbit camera that tracks one person.
const followMode = {
  id: 'follow',
  target: null,
  // opts.target: follow this person and only tighten the current zoom/tilt.
  // Without it: follow the selected person, or someone at random.
  enter(ctrl, opts) {
    if (opts?.target) {
      this.target = opts.target;
      camGoal.dist = Math.min(camGoal.dist, 9); camGoal.pitch = Math.min(camGoal.pitch, .75);
    } else {
      this.target = selected && selected.state !== 'away' ? selected : vpick(people.filter(p => isStaff(p) && p.state !== 'away')) || null;
      if (this.target) { select(this.target); camGoal.dist = 8; camGoal.pitch = .62; }
    }
  },
  exit() { this.target = null; },
  update(dt, ctrl) {
    const t = this.target;
    if (t && t.state === 'away') { ctrl.setView('free'); ctrl.update(dt); return; }
    if (t) camGoal.target.set(t.pos.x, 0.8, t.pos.z);
    orbitStep(dt, t ? 5 : 7);
  },
};

export { followMode };
