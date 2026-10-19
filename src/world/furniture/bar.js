import { S, wx, wz } from "../../config/plan.js";
import { M } from "../../render/materials.js";
import { addObs, box, cyl, frame, staticRoot } from "../helpers.js";
import { E, N, SO, WST, barStool, mkSpot } from "./basics.js";

// Bar tables with stools
function barTable(x1, y1, x2, y2, stools) {
  addObs(x1, y1, x2, y2, 1.03);
  const cx = wx((x1 + x2) / 2),
    cz = wz((y1 + y2) / 2),
    w = (x2 - x1) * S,
    d = (y2 - y1) * S;
  box(staticRoot, w, 0.05, d, M.barTop, cx, 1.03, cz);
  cyl(staticRoot, 0.05, 0.05, 1.0, M.steel, cx, 0.5, cz, 10);
  box(staticRoot, w * 0.6, 0.03, d * 0.6, M.chairBase, cx, 0.015, cz);
  stools.forEach(([px, py, face]) => {
    mkSpot("bar", px, py, face, {
      sit: true,
      hipY: 0.76,
      place: "the bar table",
    });
    barStool(frame(px, py, face));
  });
}

function buildBar() {
  barTable(428, 92, 472, 118, [
    [419, 105, E],
    [481, 105, WST],
  ]);
  barTable(636.1, 186.9, 673.9, 228.5, [
    [655.05, 178.0, SO],
    [655.05, 238.0, N],
  ]);
}

export { buildBar };
