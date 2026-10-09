import { interactables } from '../world/interactables.js';
import { ctl } from './control.js';
import { player } from './player.js';
import { updatePrompts } from './prompts.js';

// Sitting down and standing up as the player.
function seatOK(sp, p) {
  if (sp.shared) return !sp.occupant || sp.occupant === p;
  return !sp.owner || sp.owner === p || sp.owner.state === 'away';
}
function nearestSeat(p) {
  let best = null, bd = 1.15;
  const all = [...interactables.of('desk'), ...interactables.of('conf'), ...interactables.of('dining'), ...interactables.of('lounge'), ...interactables.of('bar'), ...interactables.of('booth'), ...interactables.of('music')];
  for (const sp of all) { if (!seatOK(sp, p)) continue; const d = Math.hypot(sp.pos.x - p.pos.x, sp.pos.z - p.pos.z); if (d < bd) { bd = d; best = sp; } }
  return best;
}
function sitDown(p, sp) {
  if (sp.shared) sp.occupant = p;
  player.sitting = sp; p.pos.copy(sp.pos); ctl.yaw = sp.face; ctl.pitch = -.12;
  const anim = sp.kind === 'piano' ? 'piano' : sp.kind === 'guitar' ? 'guitar' : sp.game ? 'game' : sp.kind === 'desk' ? (sp.owner === p || (p.isTeto && sp.owner?.isTeto) ? 'type' : 'listenSit') : sp.kind === 'booth' ? 'phone' : sp.kind === 'bar' ? 'drinkSit' : 'listenSit';
  p.task = { kind: 'playerSit', spot: sp, anim };
  p.body.pad.visible = !!sp.game; p.body.guitar.visible = sp.kind === 'guitar'; p.body.phone.visible = sp.kind === 'booth'; p.body.mug.visible = sp.kind === 'bar';
}
function standUp(p) {
  const sp = player.sitting; if (!sp) return;
  if (sp.shared && sp.occupant === p) sp.occupant = null;
  p.pos.copy(sp.approach); player.sitting = null; p.task = null;
  p.body.pad.visible = p.body.phone.visible = p.body.mug.visible = p.body.guitar.visible = false;
}
function toggleSit() {
  const p = player.person; if (!ctl.active || !p) return;
  if (player.sitting) standUp(p); else { const sp = nearestSeat(p); if (sp) sitDown(p, sp); }
  updatePrompts();
}

export { nearestSeat, sitDown, standUp, toggleSit };
