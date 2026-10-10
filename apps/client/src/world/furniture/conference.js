import { S } from '@office/shared';
import { M } from '../../render/materials.js';
import { E, N, SO, WST, mkSpot } from './basics.js';
import { cabinet } from './cabinet.js';
import { tv } from './tv.js';
import { addObs, addTop, box, frame } from '../helpers.js';
import { placeObject } from '../objects.js';

/** A table `w` by `d` metres with its top `h` high, drawn at the origin of `g` (a conference table, or a dining or coffee table item). */
function drawTable(g, w, d, top = M.confTable, legs = M.dark, h = .74) {
  box(g, w, .045, d, top, 0, h - .02, 0);
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => box(g, .05, h - .04, .05, legs, a * (w / 2 - .07), (h - .04) / 2, b * (d / 2 - .07)));
}
/** A fixed conference table on a plan rectangle. (Dining and coffee tables are items: shared/world/shapes.ts.) */
function table(x1, y1, x2, y2) {
  addObs(x1, y1, x2, y2); addTop(x1, y1, x2, y2, .74 + .0025);
  drawTable(frame((x1 + x2) / 2, (y1 + y2) / 2, 0), (x2 - x1) * S, (y2 - y1) * S);
}
function confSeat(n, px, py, face) {
  const spot = mkSpot('conf', px, py, face, { sit: true, place: `Conference ${n}`, room: n });
  placeObject('chair-office', px, py, face, { variant: 1, spot: spot.id });
}


function buildConference() {
  // Conference 1: two tables, eight seats facing the TV on the west wall
  table(158, 96, 174, 168);
  table(205, 96, 221, 168);
  [107, 124, 141, 158].forEach(y => { confSeat(1, 183, y, WST); confSeat(1, 230, y, WST); });
  cabinet(119, 180, 158, 191.2);
  tv(116.5, 108, 127, 156, E, 'slides');
  // The old Conference 2 is the HR office now: its desks come from the desk data (buildDesks).
  // The room keeps its cabinet and wall TV.
  cabinet(384.5, 115, 397.6, 172);
  tv(267, 108, 277, 156, E, 'slides');
  // Conference 3: long table, eight seats (the room runs down to y 329)
  table(150, 228, 186, 288);
  [238, 256, 274].forEach(y => { confSeat(3, 141, y, E); confSeat(3, 195, y, WST); });
  confSeat(3, 168, 216, SO);
  confSeat(3, 168, 300, N);
  cabinet(128, 319, 188, 326.4);
  tv(116, 234, 126, 282, E, 'dash');
}

export { drawTable, buildConference };
