import { S } from '@office/shared';
import { M } from '../../render/materials.js';
import { box } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

/** A cabinet `wPx` by `dPx` plan pixels and `h` high, drawn at the origin of `g`: the body, the top, and the lines between the doors. */
function drawCabinet(g, wPx, dPx, h = .85, mat = M.cabinet) {
  const w = wPx * S - .02, d = dPx * S - .02;
  box(g, w, h, d, mat, 0, h / 2, 0);
  box(g, w + .02, .03, d + .02, M.deskTop, 0, h + .015, 0);
  const along = w > d, n = Math.max(2, Math.round((along ? w : d) / .45));
  for (let i = 1; i < n; i++) {
    const t = -0.5 + i / n;
    if (along) box(g, .012, h - .08, d + .012, M.cabinetLine, t * w, h / 2, 0, false);
    else box(g, w + .012, h - .08, .012, M.cabinetLine, 0, h / 2, t * d, false);
  }
}
// A low cabinet (credenza), or a tall storage cabinet: an item, heavy enough that it is dragged (shared/world/shapes.ts).
function cabinet(x1, y1, x2, y2, h = .85) {
  placeLater(() => placeObject(h > 1 ? 'cabinet-tall' : 'credenza', (x1 + x2) / 2, (y1 + y2) / 2, 0, { dims: [x2 - x1, y2 - y1] }));
}

export { cabinet, drawCabinet };
