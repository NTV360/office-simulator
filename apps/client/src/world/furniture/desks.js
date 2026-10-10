import * as THREE from 'three';
import { DESK_ISLANDS, S, SEAT_GAP, seededRandom, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { SCREENS, registerScreen } from '../../render/screens.js';
import { N, SO, mkSpot } from './basics.js';
import { addObs, box, staticRoot } from '../helpers.js';
import { placeLater, placeObject, placeObjectLocal } from '../objects.js';
import { attachToObject } from '../../render/objects.js';

let seatCounter = 0; // numbers the chairs across all islands: the seed for what is on each desk

// Shared desk islands, from the static desk data (packages/shared/src/layout/desks.ts). Each chair is a 'desk' spot that knows its
// seat id ('A3') and, for the HR office, the department it belongs to.
function island(def, gap = SEAT_GAP) {
  const { name, cols, sides } = def, [x1, y1, x2, y2] = def.rect;
  let seatNo = 0;
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
      spot.deskId = def.id + (++seatNo); spot.label = def.room ? `${name} · desk ${seatNo}` : `${name}${seatNo}`; spot.department = def.department ?? null;
      const alt = (i + (top ? 0 : 1)) % 3 === 0;
      placeObject('chair-office', px, py, face, { variant: alt ? 1 : 0, spot: spot.id, station: spot.id });
      const mz = edge + half - .16;
      // the monitor, keyboard and mouse are items (render/objects.js draws them); the monitor's screen is fixed to its face and goes where it goes
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(.54, .3), SCREENS.off);
      scr.position.set(0, .27, -.017); scr.rotation.y = Math.PI;
      registerScreen(spot.id, scr);
      placeLater(() => placeObjectLocal('monitor', px, py, face, 0, mz, { station: spot.id }), o => attachToObject(o, scr));
      placeLater(() => placeObjectLocal('keyboard', px, py, face, -.03, edge + .2, { station: spot.id }));
      placeLater(() => placeObjectLocal('mouse', px, py, face, .26, edge + .2, { station: spot.id }));
      // what is on the desk: chosen once, from a fixed number per seat (it used to be different on every page load, so no two pages agreed)
      const rng = seededRandom(spot.index * 7919 + 17), r = rng(), nv = Math.floor(rng() * M.notebook.length);
      // (the notebook sits clear of the mouse: drawn overlapping, it would rest half on the mouse and tip once things have weight)
      if (r < .3) { placeObjectLocal('mug', px, py, face, -.38, edge + .32, { station: spot.id }); }
      else if (r < .45) { placeObjectLocal('notebook', px, py, face, .36, edge + .38,{ variant: nv, station: spot.id }); }
      else if (r < .52) { placeObjectLocal('plant-desk', px, py, face, -.4, mz - .05, { station: spot.id }); }
    }
  }
  return { name, cx, cz, room: !!def.room };
}

let ISLANDS;

function buildDesks() {
  seatCounter = 0;
  ISLANDS = DESK_ISLANDS.map(def => island(def));
}

export { ISLANDS, buildDesks };
