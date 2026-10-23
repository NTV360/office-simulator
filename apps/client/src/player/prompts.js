import { carriedBy, people } from "@office/shared";
import * as THREE from "three";
import { ray } from "../camera/spots.js";
import { camera } from "../render/renderer.js";
import { $, keyed } from "../ui/dom.js";
import { statusText } from "../ui/person.js";
import { ctl } from "./control.js";
import { updateLimbHud } from "./limb-hud.js";
import { player } from "./player.js";
import { nearestSeat } from "./seating.js";

const esc = (t) =>
  String(t).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const centerNdc = new THREE.Vector2(0, 0);

// The sit/stand button text, and the name + status of whoever is in the middle of the screen.
function lookedPerson() {
  const p = player.person;
  if (!p) return null;
  ray.setFromCamera(centerNdc, camera);
  const hits = ray.intersectObjects(
    people.filter((q) => q !== p && q.state !== "away").map((q) => q.body.root),
    true,
  );
  const h = hits.find((x) => x.object.userData.person && x.distance < 7);
  return h?.object.userData.person ?? null;
}

function updatePrompts() {
  const p = player.person;
  if (!p) return;
  const target = lookedPerson();
  ctl.characterTarget = target;
  player.lookAt = target; // the fpSlap button and the Power Slap key (ui/slap.js) challenge whoever you look at
  let act = "";
  if (player.aim)
    act = ""; // E uses what you aim at (ui/interact.js keeps player.aim)
  else if (player.sitting) act = "Stand up";
  else if (p.task?.kind !== "playerSit" && !carriedBy(p.id)) {
    const sp = nearestSeat(p);
    if (sp)
      act = `Sit${sp.place ? " at " + (sp.kind === "desk" && sp.owner === p ? "your desk" : sp.place) : ""}`;
  }
  const b = $("fpAct");
  b.hidden = !act;
  if (act) keyed(b, ctl.coarse ? null : "E", act);
  const who = target
    ? `<b>${esc(target.name)}</b> · ${esc(statusText(target))}`
    : "";
  const hint =
    target &&
    player.online?.character &&
    p.mechanics?.posture !== "seated" &&
    p.task?.kind !== "playerSit"
      ? p.mechanics?.holdTarget
        ? " · F release · H throw"
        : target.mechanics?.heldBy
          ? ""
          : " · Q grab"
      : "";
  const text = who + hint;
  if ($("fpLook").innerHTML !== text) $("fpLook").innerHTML = text;
  updateLimbHud();
}

export { updatePrompts };
