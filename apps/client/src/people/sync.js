import { JUMP, PROP_KEYS, people, sim } from '@office/shared';
import { isLocalPlayer } from '../player/player.js';
import { ringMats } from '../character/rig.js';
import { applyPose } from './animation.js';
import { updateBubble } from './bubbles.js';
import { updateNameTag } from './nametags.js';
import { hazelFrame, isHazel } from './hazel.js';

// Show or hide a person's meshes from their state: the simulation never touches meshes. The local player's own body
// visibility belongs to the camera (you do not see your own head), so only their props are applied here.
function applyVisibility(p) {
  const b = p.body;
  if (!isLocalPlayer(p)) { b.root.visible = p.shown; b.ring.visible = p.shown; }
  for (const k of PROP_KEYS) b[k].visible = p.props[k];
}

// Per-frame: pose a person's rig and place their meshes where the simulation says they are.
function heldRenderTransform(p, seen = new Set()) {
  const base = { x: p.pos.x, z: p.pos.z, face: p.face, y: 0 };
  if (seen.has(p.id)) return base;
  const holderId = p.mechanics?.heldBy ? Number(p.mechanics.heldBy) : NaN;
  const holder = Number.isInteger(holderId) ? people.find(candidate => candidate.id === holderId) : null;
  if (!holder || holder === p) return base;
  seen.add(p.id);
  const parent = heldRenderTransform(holder, seen);
  const az = Number.isFinite(holder.mechanics?.holdAz) ? holder.mechanics.holdAz : 0;
  const lift = Number.isFinite(holder.mechanics?.holdLift) ? holder.mechanics.holdLift : 1;
  const face = parent.face + az;
  return { x: parent.x + Math.sin(face) * .6, z: parent.z + Math.cos(face) * .6, face, y: parent.y + lift - 1 };
}

function syncBody(p, dt) {
  applyVisibility(p);
  updateNameTag(p);
  updateBubble(p);
  if (isHazel(p)) { const speed = sim.paused ? 0 : Math.min(sim.speed, 2.5); hazelFrame(p, dt, dt * speed); } // her tricycle, her chick and her movies (people/hazel.js)
  if (p.state === 'away') return;
  if (!sim.paused || isLocalPlayer(p) || p.state === 'controlled') applyPose(p, dt); // (a paused office is frozen, but players still move)
  const b = p.body;
  const held = heldRenderTransform(p);
  const renderX = held.x, renderZ = held.z, renderFace = held.face, attachmentY = held.y;
  const crouch = p.mechanics?.posture === 'crouching' ? (p.mechanics.crouchLevel || 0) : 0;
  let jumpY = 0;
  if (p.mechanics?.locomotion === 'jump') {
    if (p._buf) {
      // Online snapshots carry the authoritative vertical velocity. Derive the
      // ballistic height from it instead of integrating the same velocity once
      // per render frame (which makes jump height depend on display refresh rate).
      const velocity = Number.isFinite(p.mechanics.verticalVelocity) ? p.mechanics.verticalVelocity : 0;
      const elapsed = Math.max(0, Math.min(JUMP.duration, (JUMP.velocity - velocity) / 9.8));
      jumpY = Math.max(0, JUMP.velocity * elapsed - 4.9 * elapsed * elapsed);
    } else {
      jumpY = Math.max(0, (p._jumpY || 0) + (p.mechanics.verticalVelocity || 0) * dt);
    }
    p._jumpY = jumpY;
  } else {
    p._jumpY = 0;
  }
  b.root.position.set(renderX, attachmentY + jumpY, renderZ); b.root.rotation.y = renderFace;
  b.ring.position.set(renderX, .015, renderZ);
  const cat = p.state === 'walking' ? 'walk' : (p.task?.kind === 'work' && p.chatWith ? 'chat' : p.task?.cat || 'walk');
  if (b.ring.material !== ringMats[cat]) b.ring.material = ringMats[cat];
}

export { syncBody };
