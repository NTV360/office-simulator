import * as THREE from 'three';
import { S, seededRandom, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { SCREENS, registerScreen } from '../../render/screens.js';
import { N, SO, mkSpot, officeChair } from './basics.js';
import { addObs, box, cyl, dynamic, frame, staticRoot } from '../helpers.js';
import { placeObject, placeObjectLocal } from '../objects.js';

// Shared desk islands
let seatCounter = 0;
function island(name, x1, y1, x2, y2, cols, sides = ['top', 'bottom'], gap = 12.8) {
  addObs(x1, y1, x2, y2);
  const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
  box(staticRoot, w, .04, d, M.deskTop, cx, .74, cz);
  box(staticRoot, w + .01, .02, d + .01, M.deskEdge, cx, .71, cz, false);
  [-1, 1].forEach(s => box(staticRoot, .04, .7, d - .12, M.deskEdge, cx + s * (w / 2 - .06), .36, cz));
  box(staticRoot, w - .04, .34, .035, M.fabric, cx, .93, cz);
  const cw = (x2 - x1) / cols;
  for (let i = 1; i < cols; i++) box(staticRoot, .03, .26, d - .04, M.fabric, wx(x1 + i * cw), .89, cz);
  const half = d / 2, edge = gap * S;
  for (const side of sides) {
    const top = side === 'top';
    for (let i = 0; i < cols; i++) {
      const px = x1 + (i + .5) * cw, py = top ? y1 - gap : y2 + gap, face = top ? SO : N;
      const spot = mkSpot('desk', px, py, face, { sit: true, place: name, shared: false });
      spot.index = ++seatCounter;
      const f = frame(px, py, face);
      const alt = (i + (top ? 0 : 1)) % 3 === 0;
      officeChair(f, alt ? M.chairSeat2 : M.chairSeat);
      placeObject('chair-office', px, py, face, { variant: alt ? 1 : 0, spot: spot.id, station: spot.id });
      const mz = edge + half - .16;
      box(f, .22, .012, .16, M.monitor, 0, .766, mz);
      box(f, .05, .14, .04, M.monitor, 0, .84, mz + .02);
      box(f, .58, .34, .03, M.monitor, 0, 1.03, mz);
      const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(.54, .3), SCREENS.off));
      scr.position.set(0, 1.03, mz - .017); scr.rotation.y = Math.PI; f.add(scr);
      registerScreen(spot.id, scr);
      box(f, .4, .018, .13, M.keyboard, -.03, .77, edge + .2, false);
      box(f, .05, .02, .08, M.keyboard, .26, .77, edge + .2, false);
      // what is on the desk: chosen once, from a fixed number per seat (it used to be different on every page load, so no two pages agreed)
      const rng = seededRandom(spot.index * 7919 + 17), r = rng(), nv = Math.floor(rng() * M.notebook.length);
      if (r < .3) { cyl(f, .04, .035, .1, M.white, -.38, .81, edge + .32, 10); placeObjectLocal('mug', px, py, face, -.38, edge + .32, { station: spot.id }); }
      else if (r < .45) { box(f, .2, .025, .27, M.notebook[nv], .36, .775, edge + .35, false); placeObjectLocal('notebook', px, py, face, .36, edge + .35, { variant: nv, station: spot.id }); }
      else if (r < .52) { cyl(f, .06, .05, .1, M.pot, -.4, .81, mz - .05, 10); const l = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), M.leaf); l.position.set(-.4, .92, mz - .05); f.add(l); placeObjectLocal('plant-desk', px, py, face, -.4, mz - .05, { station: spot.id }); }
    }
  }
  return { name, cx, cz };
}

let ISLANDS;

function buildDesks() {
  ISLANDS = [
    island('Table A', 451.7, 164.7, 601.7, 212.4, 4), island('Table B', 451.7, 253.5, 601.7, 301.3, 4), island('Table C', 451.7, 361.3, 601.7, 409.0, 4),
    island('Table D', 451.7, 482.4, 601.7, 530.1, 4), island('Table E', 451.7, 587.9, 601.7, 635.6, 4),
    island('Table G', 416.7, 691.2, 622.2, 740.1, 6), island('Table H', 415.6, 793.4, 621.1, 842.2, 6),
    // table F: eight seats, the old six (same places) and two more to the east
    island('Table F', 240.7, 218.5, 436.9667, 253.0, 8, ['bottom']),
  ];
}

export { ISLANDS, buildDesks };
