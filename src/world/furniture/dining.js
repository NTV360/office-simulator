import { W } from '../../config/plan.js';
import { M } from '../../render/materials.js';
import { E, WST, mkSpot, woodChair } from './basics.js';
import { table } from './conference.js';
import { cyl, frame, staticRoot } from '../helpers.js';
import { interactables } from '../interactables.js';

// Dining area: 6 compact tables, 18 seats (shifted west to make room for the mini golf green)
function diningTable(x1, y1, x2, y2, ys) {
  table(x1, y1, x2, y2, M.diningWood, M.diningWood2);
  for (const y of ys) for (const [px, face] of [[x1 - 8, E], [x2 + 8, WST]]) {
    mkSpot('dining', px, y, face, { sit: true, hipY: .52, place: 'the dining area' });
    woodChair(frame(px, y, face));
  }
}


// Where two people stand for a Power Slap (sim/slap.js): face to face at the open end of a table, close
// enough to reach (across the table would be out of reach). Each pair is one `table`.
function slapSpots(cx, y) {
  const table = interactables.of('slap').length / 2;
  [[cx - 9, E], [cx + 9, WST]].forEach(([x, face]) => { mkSpot('slap', x, y, face, { place: 'the dining area' }).table = table; });
}

function buildDining() {
  [[464, 494], [529, 559], [594, 624]].forEach(([a, b]) => {
    diningTable(a, 971, b, 1005, [980.5, 995.5]);
    const c = W((a + b) / 2, 988); cyl(staticRoot, .004, .004, .9, M.dark, c.x, 2.45, c.z, 4, false); cyl(staticRoot, .05, .2, .17, M.cap, c.x, 1.95, c.z, 18);
    slapSpots((a + b) / 2, 962);
  });
  [[466, 490], [532, 556], [598, 622]].forEach(([a, b]) => { diningTable(a, 1044, b, 1068, [1056]); slapSpots((a + b) / 2, 1078); });
}

export { buildDining };
