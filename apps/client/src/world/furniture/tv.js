import { S, vpick } from "@office/shared";
import * as THREE from "three";
import { M } from "../../render/materials.js";
import { attachToObject } from "../../render/objects.js";
import { TV_MATS } from "../../render/screens.js";
import { box } from "../helpers.js";
import { placeLater, placeObject } from "../objects.js";

// TV on a floor stand (works with low or full walls). It is an item (shared/world/shapes.ts); its screen is fixed to its face and goes with it.
const TV_SCREENS = [];
/** The stand and the frame of a TV `w` metres wide, drawn at the origin of `g` (not the screen: each shows its own picture). */
function drawTvStand(g, w) {
  const h = w * 0.56,
    yc = 0.95 + h / 2;
  box(g, 0.5, 0.03, 0.32, M.chairBase, 0, 0.015, -0.02);
  box(g, 0.07, yc, 0.05, M.chairBase, 0, yc / 2, -0.06);
  box(g, w + 0.04, h + 0.04, 0.05, M.monitor, 0, yc, 0);
}
function tv(x1, y1, x2, y2, face, kind = "slides") {
  const along = Math.max(x2 - x1, y2 - y1),
    across = Math.min(x2 - x1, y2 - y1);
  const w = Math.min(along * S, 2.1),
    h = w * 0.56,
    yc = 0.95 + h / 2;
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.02, h - 0.02),
    vpick(TV_MATS[kind]),
  );
  scr.position.set(0, yc, 0.027);
  TV_SCREENS.push(scr);
  placeLater(
    () =>
      placeObject("tv-stand", (x1 + x2) / 2, (y1 + y2) / 2, face, {
        dims: [along, across],
      }),
    (o) => attachToObject(o, scr),
  );
  return scr;
}

export { drawTvStand, tv, TV_SCREENS };
