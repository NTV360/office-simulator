import logoUrl from '../../assets/logo.png';
import * as THREE from 'three';
import { S, WALL_T, wx, wz } from '../../config/plan.js';
import { vpick } from '@office/shared';
import { M } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, N, SO, WST, mkSpot } from './basics.js';
import { table } from './conference.js';
import { addObs, box, cyl, dynamic, frame, staticRoot } from '../helpers.js';

// Lounge seating
function sofa(x1, y1, x2, y2, face, seats, place, aps, single = false) {
  addObs(x1, y1, x2, y2);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, horiz = face === SO || face === N;
  const len = (horiz ? x2 - x1 : y2 - y1) * S, dep = (horiz ? y2 - y1 : x2 - x1) * S;
  const f = frame(cx, cy, face);
  box(f, len, .22, dep, M.sofaDark, 0, .2, 0);
  box(f, len - .12, .12, dep - .14, single ? M.armchair : M.sofa, 0, .37, .04);
  box(f, len, .42, .16, single ? M.armchair : M.sofa, 0, .55, -dep / 2 + .08);
  [-1, 1].forEach(s => box(f, .13, .3, dep, M.sofaDark, s * (len / 2 - .065), .42, 0));
  seats.forEach(([px, py], i) => mkSpot('lounge', px, py, face, { sit: true, hipY: .5, place, ap: aps[i] }));
}


function buildLounge() {
  sofa(150, 309, 198, 325, SO, [[158.5, 318.5], [174, 318.5], [189.5, 318.5]], 'the lounge sofa', [[158.5, 336], [174, 336], [189.5, 336]]);
  sofa(116.5, 342, 134, 369, E, [[125.5, 349], [125.5, 362]], 'the couch', [[143, 349], [143, 362]]);
  // NTV360 brand wall above the entrance sofa (stays full height so the logo reads in every view)
  {
    const x1 = 144, x2 = 204, y = 305 + WALL_T / 2 + .6, cx = wx((x1 + x2) / 2), z = wz(y), w = (x2 - x1) * S;
    addObs(x1, 305, x2, y + .8);
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
  sofa(340.7, 336.3, 382.9, 350.7, N, [[350, 342], [362, 342], [374, 342]], 'the TV sofa', [[333, 343], [390, 344], [390, 344]]);
  sofa(339.3, 280.2, 355.4, 295.7, SO, [[347.35, 287]], 'an armchair', [[347.35, 268]], true);
  sofa(363.2, 280.2, 379.3, 295.7, SO, [[371.25, 287]], 'an armchair', [[371.25, 268]], true);
  sofa(387.9, 296.0, 403.4, 312.1, WST, [[396, 304]], 'an armchair', [[412, 304]], true);
  sofa(387.9, 320.5, 403.4, 336.6, WST, [[396, 328.5]], 'an armchair', [[412, 328.5]], true);
  table(340.1, 309.1, 380.6, 329.1, M.diningWood, M.diningWood2, .42);
  box(staticRoot, .22, .03, .3, vpick(M.notebook), wx(352), .425, wz(318), false);
  cyl(staticRoot, .05, .04, .1, M.white, wx(368), .47, wz(316), 10, false);
}

export { buildLounge };
