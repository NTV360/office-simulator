import { interactables, seatUnusable, sitFree, slap } from "@office/shared";
import { ctl } from "./control.js";
import { player } from "./player.js";
import { updatePrompts } from "./prompts.js";

// Sitting down and standing up as the player.
function seatOK(sp, p) {
  if (seatUnusable(sp)) return false; // the chair is carried or knocked over
  if (slap.seat(sp)) return false; // a slap-table seat in a live fight is a fighting place, not a seat
  if (sp.occupant && sp.occupant !== p) return false; // somebody (a human at a desk too) is in it
  if (sp.shared) return true;
  return !sp.owner || sp.owner === p || sp.owner.state === "away";
}
function nearestSeat(p) {
  let best = null,
    bd = 1.15;
  for (const sp of interactables.all()) {
    if (sp.kind === "slap" || !seatOK(sp, p)) continue;
    const d = Math.hypot(sp.pos.x - p.pos.x, sp.pos.z - p.pos.z);
    if (d < bd) {
      bd = d;
      best = sp;
    }
  }
  return best;
}
// The Power Slap table you are standing at. ui/interact.js calls this every tick you steer; it is also what the slap buttons sit on.
function nearestSlap(p) {
  for (const sp of interactables.of("slap"))
    if (Math.hypot(sp.pos.x - p.pos.x, sp.pos.z - p.pos.z) < 1.6) return sp;
  return null;
}
function sitDown(p, sp) {
  sp.occupant = p;
  player.sitting = sp;
  p.pos.copy(sp.pos);
  p.face = p.faceGoal = sp.face;
  ctl.yaw = sp.face;
  ctl.pitch = -0.12;
  p.mechanics.posture = "seated";
  p.mechanics.seatMode = "fixed-chair";
  p.mechanics.seatId = sp.id;
  p.mechanics.crouchLevel = 0;
  p.mechanics.grounded = true;
  p.mechanics.locomotion = "grid";
  const anim =
    sp.kind === "piano"
      ? "piano"
      : sp.kind === "guitar"
        ? "guitar"
        : sp.game
          ? "game"
          : sp.kind === "desk"
            ? sp.owner === p
              ? "type"
              : "listenSit"
            : sp.kind === "booth"
              ? "phone"
              : sp.kind === "bar"
                ? "drinkSit"
                : "listenSit";
  p.task = { kind: "playerSit", spot: sp, anim };
  p.props.pad = !!sp.game;
  p.props.guitar = sp.kind === "guitar";
  p.props.phone = sp.kind === "booth";
  p.props.mug = sp.kind === "bar";
}
function standUp(p) {
  const sp = player.sitting;
  if (!sp) return;
  if (sp.occupant === p) sp.occupant = null;
  p.pos.copy(sp.approach);
  player.sitting = null;
  p.task = null;
  p.mechanics.posture = "standing";
  p.mechanics.seatMode = "none";
  p.mechanics.seatId = null;
  p.mechanics.grounded = true;
  p.mechanics.locomotion = "grid";
  p.props.pad = p.props.phone = p.props.mug = p.props.guitar = false;
}
function toggleSit() {
  const p = player.person;
  if (!ctl.active || !p) return;
  if (player.online) {
    player.online.act(player.sitting ? "stand" : "sit");
    return;
  } // the server decides; the answer arrives as the next snapshot
  if (player.sitting) standUp(p);
  else {
    const sp = nearestSeat(p);
    if (sp) sitDown(p, sp);
    else if (sitFree(p)) {
      player.sitting = p.task?.spot ?? null;
      ctl.yaw = p.face;
      ctl.pitch = -0.12;
    }
  }
  updatePrompts();
}

export { nearestSeat, nearestSlap, sitDown, standUp, toggleSit };
