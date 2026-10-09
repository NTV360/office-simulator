import * as THREE from 'three';
import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { SCREENS, registerScreen } from '../../render/screens.js';
import { E, WST, mkSpot, officeChair } from './basics.js';
import { addObs, box, dynamic, frame, staticRoot } from '../helpers.js';

// Desks that belong to a role rather than to the usual mix: the HR office (the chairs of Conference 2), the CTO desks (two chairs of
// Conference 1) and the cleaner's station in the storage room. They are ordinary desks (kind 'desk', so an admin can give them to an
// account like any other) that name the role seated there. They are made after all the other desks so every older desk keeps its id.

const HR = 'the HR office', CTO = 'the CTO desks', CLEANER = 'the cleaning station';
const TABLE_TOP = .7425; // the conference tables' surface

/** A laptop (or small monitor) on a surface `top` metres high, `fwd` metres in front of the chair, its screen facing the chair. */
function laptop(f, spotId, fwd, top) {
  box(f, .32, .015, .22, M.monitor, 0, top + .0075, fwd);
  box(f, .32, .21, .012, M.monitor, 0, top + .105, fwd + .1);
  const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(.29, .18), SCREENS.off));
  scr.position.set(0, top + .11, fwd + .1 - .008); scr.rotation.y = Math.PI; f.add(scr);
  registerScreen(spotId, scr);
}

function station(px, py, face, place, role, fwd, top = TABLE_TOP) {
  const spot = mkSpot('desk', px, py, face, { sit: true, place, shared: false, role });
  const f = frame(px, py, face);
  officeChair(f, M.chairSeat2);
  laptop(f, spot.id, fwd, top);
  return spot;
}

function buildStations() {
  // HR: the five chairs of Conference 2, at its big table (the fifth is the corner chair, turned toward the table)
  station(294, 118, E, HR, 'HR', .65);
  station(294, 147, E, HR, 'HR', .65);
  station(366, 118, WST, HR, 'HR', .65);
  station(366, 147, WST, HR, 'HR', .65);
  station(366, 92, Math.atan2(330 - 366, 132 - 92), HR, 'HR', .85); // (further out: the table's corner is a way off from this chair)
  // CTOs: the two chairs at the north end of Conference 1's tables
  station(183, 107, WST, CTO, 'CTO', .57);
  station(230, 107, WST, CTO, 'CTO', .57);
  // The cleaner: a small desk along the west wall of the storage room
  const x1 = 274.5, x2 = 286, y1 = 1052, y2 = 1071;
  addObs(x1, y1, x2, y2);
  const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
  box(staticRoot, w, .04, d, M.deskTop, cx, .74, cz);
  [-1, 1].forEach(s => box(staticRoot, w - .04, .7, .04, M.deskEdge, cx, .36, cz + s * (d / 2 - .04)));
  station(293, 1061.5, WST, CLEANER, 'Cleaner', .5, .76);
}

export { buildStations };
