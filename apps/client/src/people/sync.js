import { PROP_KEYS, sim } from '@office/shared';
import { isLocalPlayer } from '../player/player.js';
import { ringMats } from '../character/rig.js';
import { applyPose } from './animation.js';

// Show or hide a person's meshes from their state: the simulation never touches meshes. The local player's own body
// visibility belongs to the camera (you do not see your own head), so only their props are applied here.
function applyVisibility(p) {
  const b = p.body;
  if (!isLocalPlayer(p)) { b.root.visible = p.shown; b.ring.visible = p.shown; }
  for (const k of PROP_KEYS) b[k].visible = p.props[k];
}

// Per-frame: pose a person's rig and place their meshes where the simulation says they are.
function syncBody(p, dt) {
  applyVisibility(p);
  if (p.state === 'away') return;
  if (!sim.paused || isLocalPlayer(p) || p.state === 'controlled') applyPose(p, dt); // (a paused office is frozen, but players still move)
  const b = p.body; b.root.position.set(p.pos.x, 0, p.pos.z); b.root.rotation.y = p.face;
  b.ring.position.set(p.pos.x, .015, p.pos.z);
  const cat = p.state === 'walking' ? 'walk' : (p.task?.kind === 'work' && p.chatWith ? 'chat' : p.task?.cat || 'walk');
  if (b.ring.material !== ringMats[cat]) b.ring.material = ringMats[cat];
}

export { syncBody };
