import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { addObs, box, staticRoot } from '../helpers.js';

// Low cabinet / credenza
function cabinet(x1, y1, x2, y2, h = .85, mat = M.cabinet) {
  addObs(x1, y1, x2, y2);
  const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S - .02, d = (y2 - y1) * S - .02;
  box(staticRoot, w, h, d, mat, cx, h / 2, cz);
  box(staticRoot, w + .02, .03, d + .02, M.deskTop, cx, h + .015, cz);
  const along = w > d, n = Math.max(2, Math.round((along ? w : d) / .45));
  for (let i = 1; i < n; i++) {
    const t = -0.5 + i / n;
    if (along) box(staticRoot, .012, h - .08, d + .012, M.cabinetLine, cx + t * w, h / 2, cz, false);
    else box(staticRoot, w + .012, h - .08, .012, M.cabinetLine, cx, h / 2, cz + t * d, false);
  }
}

export { cabinet };
