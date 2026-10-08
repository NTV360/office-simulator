import * as THREE from 'three';
import { S } from '../../config/plan.js';
import { pick } from '../../core/util.js';
import { M } from '../../render/materials.js';
import { TV_MATS } from '../../render/screens.js';
import { addObs, box, dynamic, frame } from '../helpers.js';

// TV on a floor stand (works with low or full walls)
const TV_SCREENS = [];
function tv(x1, y1, x2, y2, face, kind = 'slides') {
  addObs(x1, y1, x2, y2);
  const along = Math.max(x2 - x1, y2 - y1) * S, f = frame((x1 + x2) / 2, (y1 + y2) / 2, face);
  const w = Math.min(along, 2.1), h = w * .56, yc = .95 + h / 2;
  box(f, .5, .03, .32, M.chairBase, 0, .015, -.02);
  box(f, .07, yc, .05, M.chairBase, 0, yc / 2, -.06);
  box(f, w + .04, h + .04, .05, M.monitor, 0, yc, 0);
  const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(w - .02, h - .02), pick(TV_MATS[kind])));
  scr.position.set(0, yc, .027); f.add(scr); TV_SCREENS.push(scr);
  return scr;
}

export { tv };
