import { ringMats } from '../character/rig.js';
import { sim } from '../sim/state.js';
import { applyPose } from './animation.js';

// Per-frame: pose a person's rig and place their meshes where the simulation says they are.
function syncBody(p, dt) {
  if (p.state === 'away') return;
  if (!sim.paused || p.state === 'player') applyPose(p, dt);
  const b = p.body; b.root.position.set(p.pos.x, 0, p.pos.z); b.root.rotation.y = p.face + (p.spin || 0);
  b.ring.position.set(p.pos.x, .015, p.pos.z);
  const cat = p.state === 'walking' ? 'walk' : (p.task?.kind === 'work' && p.chatWith ? 'chat' : p.task?.cat || 'walk');
  if (b.ring.material !== ringMats[cat]) b.ring.material = ringMats[cat];
}

export { syncBody };
