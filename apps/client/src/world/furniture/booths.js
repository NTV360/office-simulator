import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { doorLeaf } from '../doors.js';
import { SO, mkSpot, officeChair } from './basics.js';
import { addObs, box, cyl, frame, staticRoot } from '../helpers.js';
import { wallSeg } from '../walls.js';


function buildBooths() {
  
  // Compact booths, doors facing the desks
  for (let i = 0; i < 4; i++) {
    const x0 = 482.3 + i * 50, x1 = x0 + 50, cx = (x0 + x1) / 2, y0 = 894.5, y1 = 937.8, T = 1.8, BH = 2.25;
    const solid = (a, b, c, d) => wallSeg(a, b, c, d, M.booth, BH, T, M.boothFrame);
    if (i === 0) solid(x0, y0, x0, y1);
    if (i < 3) solid(x1, y0, x1, y1);
    solid(x0, y1, x1, y1);
    wallSeg(x0, y0, x0 + 6.5, y0, M.boothGlass, BH, T, M.boothFrame);
    wallSeg(x0 + 28.5, y0, x1, y0, M.boothGlass, BH, T, M.boothFrame);
    doorLeaf(x0 + 6.5, y0, 21, -1.15, 1, M.boothGlass, 2.1);
    addObs(x0, 927, x1, y1);
    box(staticRoot, (x1 - x0 - 4) * S, .04, .34, M.diningWood, wx(cx), .74, wz(932.5));
    box(staticRoot, (x1 - x0 - 4) * S, .7, .04, M.diningWood2, wx(cx), .37, wz(936.5));
    cyl(staticRoot, .07, .05, .05, M.dark, wx(cx) + .45, .785, wz(933), 10);
    mkSpot('booth', cx, 914, SO, { sit: true, place: `Booth B${i + 1}`, ap: [x0 + 17.5, 906] });
    officeChair(frame(cx, 914, SO));
  }
}

export { buildBooths };
