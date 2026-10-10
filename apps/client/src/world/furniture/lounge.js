import logoUrl from '../../assets/logo.png';
import * as THREE from 'three';
import { S, WALL_T, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, N, SO, WST, mkSpot } from './basics.js';
import { addObs, box, dynamic, staticRoot } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

// Lounge seating
/** A sofa (or an armchair) `len` long and `dep` deep, drawn at the origin of `g`, facing +z. */
function drawSofa(g, len, dep, single) {
  box(g, len, .22, dep, M.sofaDark, 0, .2, 0);
  box(g, len - .12, .12, dep - .14, single ? M.armchair : M.sofa, 0, .37, .04);
  box(g, len, .42, .16, single ? M.armchair : M.sofa, 0, .55, -dep / 2 + .08);
  [-1, 1].forEach(s => box(g, .13, .3, dep, M.sofaDark, s * (len / 2 - .065), .42, 0));
}
// A sofa is an item that carries its seats: move it and they go with it (shared/world/shapes.ts has its shape).
function sofa(x1, y1, x2, y2, face, seats, place, aps, single = false) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, horiz = face === SO || face === N;
  const len = horiz ? x2 - x1 : y2 - y1, dep = horiz ? y2 - y1 : x2 - x1;
  const ids = seats.map(([px, py], i) => mkSpot('lounge', px, py, face, { sit: true, hipY: .5, place, ap: aps[i] }).id);
  const type = single ? 'armchair' : seats.length >= 3 ? 'sofa' : 'couch';
  placeLater(() => placeObject(type, cx, cy, face, { dims: [len, dep], spot: ids[0], spots: ids.slice(1) }));
}


function buildLounge() {
  sofa(156, 333, 204, 349, SO, [[164.5, 342.5], [180, 342.5], [195.5, 342.5]], 'the lounge sofa', [[164.5, 360], [180, 360], [195.5, 360]]);
  sofa(116.5, 342, 134, 369, E, [[125.5, 349], [125.5, 362]], 'the couch', [[143, 349], [143, 362]]);
  // NTV360 brand wall above the entrance sofa (stays full height so the logo reads in every view)
  {
    const x1 = 150, x2 = 210, y = 329 + WALL_T / 2 + .6, cx = wx((x1 + x2) / 2), z = wz(y), w = (x2 - x1) * S;
    addObs(x1, 329, x2, y + .8);
    box(staticRoot, w, 2.7, .05, M.brandPanel, cx, 1.35, z);
    box(staticRoot, w + .02, .04, .07, M.cap, cx, 2.72, z, false);
    const logoImg = new Image();
    const logoTex = new THREE.Texture(logoImg); logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 8;
    logoImg.onload = () => { logoTex.needsUpdate = true; };
    logoImg.src = logoUrl;
    const lw = Math.min(1.5, w - .4), lh = lw * 1413 / 1660;
    const logo = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, alphaTest: .02, toneMapped: false })));
    logo.position.set(cx, 1.78, z + .03); scene.add(logo);
    // soft wall-wash light strip above the logo
    box(staticRoot, lw + .2, .025, .06, M.white, cx, 2.5, z + .04, false);
  }
  // The TV lounge (sofa, armchairs, table; TV and its wall in game.js and walls.js) sits toward the entrance,
  // leaving room for Desk D and the walkway to the HR office
  sofa(340.7, 360.3, 382.9, 374.7, N, [[350, 366], [362, 366], [374, 366]], 'the TV sofa', [[333, 367], [390, 368], [390, 368]]);
  // the two armchairs facing the coffee table, kept clear of Desk D's chairs
  sofa(339.3, 310.2, 355.4, 325.7, SO, [[347.35, 317]], 'an armchair', [[347.35, 298]], true);
  sofa(363.2, 310.2, 379.3, 325.7, SO, [[371.25, 317]], 'an armchair', [[371.25, 298]], true);
  sofa(387.9, 320.0, 403.4, 336.1, WST, [[396, 328]], 'an armchair', [[412, 328]], true);
  sofa(387.9, 344.5, 403.4, 360.6, WST, [[396, 352.5]], 'an armchair', [[412, 352.5]], true);
  placeLater(() => placeObject('table-coffee', (340.1 + 380.6) / 2, (333.1 + 353.1) / 2, 0, { dims: [380.6 - 340.1, 353.1 - 333.1] }));
  // a notebook and a cup on it (after the table, so they stand on it)
  placeLater(() => placeObject('notebook', 352, 342, 0, { y: .4225, variant: 2 }));
  placeLater(() => placeObject('cup', 368, 340, 0, { y: .4225 }));
}

export { buildLounge, drawSofa };
