import { S, wx, wz } from '../../config/plan.js';
import { M } from '../../render/materials.js';
import { E, N, SEATS, SO, WST, mkSpot, officeChair } from './basics.js';
import { cabinet } from './cabinet.js';
import { tv } from './tv.js';
import { addObs, box, frame, staticRoot } from '../helpers.js';

function table(x1, y1, x2, y2, top = M.confTable, legs = M.dark, h = .74) {
  addObs(x1, y1, x2, y2);
  const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
  box(staticRoot, w, .045, d, top, cx, h - .02, cz);
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => box(staticRoot, .05, h - .04, .05, legs, cx + a * (w / 2 - .07), (h - .04) / 2, cz + b * (d / 2 - .07)));
}
function confSeat(n, px, py, face) {
  SEATS.conf[n].push(mkSpot('conf', px, py, face, { sit: true, place: `Conference ${n}`, room: n }));
  officeChair(frame(px, py, face), M.chairSeat2);
}
// Conference 1: two tables, ten seats facing the TV on the west wall
table(158, 96, 174, 168); table(205, 96, 221, 168);
[107, 124, 141, 158].forEach(y => { confSeat(1, 183, y, WST); confSeat(1, 230, y, WST); });
cabinet(119, 180, 158, 191.2);
tv(116.5, 108, 127, 156, E, 'slides');
// Conference 2: square table, four chairs plus a corner chair
table(305, 105, 355, 160);
confSeat(2, 294, 118, E); confSeat(2, 294, 147, E); confSeat(2, 366, 118, WST); confSeat(2, 366, 147, WST);
confSeat(2, 366, 92, Math.atan2(330 - 366, 132 - 92));
cabinet(384.5, 115, 397.6, 172);
tv(267, 108, 277, 156, E, 'slides');
// Conference 3: long table, ten seats
table(150, 224, 186, 272);
[233, 248, 263].forEach(y => { confSeat(3, 141, y, E); confSeat(3, 195, y, WST); });
confSeat(3, 168, 213, SO); confSeat(3, 168, 283, N);
cabinet(128, 295, 188, 302.4);
tv(116, 222, 126, 270, E, 'dash');

export { table };
