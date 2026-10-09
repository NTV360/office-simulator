import { S } from '@office/shared';
import { M } from '../../render/materials.js';
import { N, SO, mkSpot } from './basics.js';
import { cabinet } from './cabinet.js';
import { addObs, box, frame } from '../helpers.js';


function buildStorage() {
  
  // Storage room
  cabinet(276.8, 1041.6, 326.2, 1051.1, 1.85, M.cabinet);
  cabinet(281.8, 1072.7, 338.4, 1082.7, 1.85, M.cabinet);
  mkSpot('storage', 309, 1062, SO, { place: 'the storage room' }); mkSpot('storage', 322, 1061, N, { place: 'the storage room' });
  // Lockers along the wall below the dining tables (as in Draft 06: Locker 2 left, Locker 1 right)
  [[455, 562, 'Locker 2'], [562, 669, 'Locker 1']].forEach(([x1, x2, name]) => {
    const y1 = 1096, y2 = 1110.6; addObs(x1, y1, x2, y2);
    const f = frame((x1 + x2) / 2, (y1 + y2) / 2, N), w = (x2 - x1) * S - .04, d = (y2 - y1) * S, n = 6;
    box(f, w, 1.9, d, M.locker, 0, .95, 0);
    for (let i = 1; i < n; i++) box(f, .015, 1.86, .01, M.lockerLine, -w / 2 + i * w / n, .95, d / 2 + .005, false);
    box(f, w, .015, .01, M.lockerLine, 0, .95, d / 2 + .005, false);
    for (let i = 0; i < n; i++) for (const y of [.6, 1.55]) box(f, .02, .1, .02, M.steel, -w / 2 + (i + .8) * w / n, y, d / 2 + .015, false);
    [x1 + 27, x1 + 70].forEach(px => mkSpot('locker', px, 1085, SO, { place: name }));
  });
}

export { buildStorage };
