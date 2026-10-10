import { M } from '../../render/materials.js';
import { E, N, SO, WST, mkSpot } from './basics.js';
import { box, cyl } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

// Bar tables with stools
/** A bar table `w` by `d` metres drawn at the origin of `g`: the top, the pole and the foot plate (it is an item: shared/world/shapes.ts). */
function drawBarTable(g, w, d) {
  box(g, w, .05, d, M.barTop, 0, 1.03, 0);
  cyl(g, .05, .05, 1.0, M.steel, 0, .5, 0, 10); box(g, w * .6, .03, d * .6, M.chairBase, 0, .015, 0);
}
function barTable(x1, y1, x2, y2, stools) {
  placeLater(() => placeObject('table-bar', (x1 + x2) / 2, (y1 + y2) / 2, 0, { dims: [x2 - x1, y2 - y1] }));
  stools.forEach(([px, py, face]) => { const spot = mkSpot('bar', px, py, face, { sit: true, hipY: .76, place: 'the bar table' }); placeObject('stool-bar', px, py, face, { spot: spot.id }); });
}


function buildBar() {
  barTable(428, 92, 472, 118, [[419, 105, E], [481, 105, WST]]);
  barTable(636.1, 186.9, 673.9, 228.5, [[655.05, 178.0, SO], [655.05, 238.0, N]]);
}

export { buildBar, drawBarTable };
