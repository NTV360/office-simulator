import * as THREE from 'three';
import { S, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { SO, WST, mkSpot } from './basics.js';
import { addObs, box, boxGeo, cyl, staticRoot } from '../helpers.js';


function buildKitchen() {
  
  // Counter top with coffee machine
  {
    addObs(351.8, 994.4, 429.5, 1034.4);
    const cx = wx(390.65), cz = wz(1014.4), w = 77.7 * S, d = 40 * S;
    box(staticRoot, w, .92, d, M.counter, cx, .46, cz);
    box(staticRoot, w + .04, .04, d + .04, M.deskTop, cx, .94, cz);
    box(staticRoot, .32, .4, .3, M.monitor, cx + .55, 1.16, cz - .3);
    box(staticRoot, .16, .02, .12, M.steel, cx + .73, 1.03, cz - .3, false);
    const led = new THREE.Mesh(boxGeo(.01, .03, .03), M.red); led.position.set(cx + .72, 1.28, cz - .26); staticRoot.add(led);
    cyl(staticRoot, .13, .13, .4, M.waterBottle, cx + .7, 1.17, cz + .35, 16);
    box(staticRoot, .4, .3, .3, M.steel, cx - .6, 1.11, cz - .25);
    for (let i = 0; i < 4; i++) cyl(staticRoot, .035, .03, .08, M.white, cx + .25, .99, cz - .2 + i * .1, 10, false);
    cyl(staticRoot, .14, .1, .08, M.diningWood2, cx - .1, .99, cz + .25, 14);
    mkSpot('counter', 442, 1004, WST, { place: 'the counter' }); mkSpot('counter', 442, 1024, WST, { place: 'the counter' });
  }
  // Sink
  {
    addObs(351.8, 1061.1, 437.3, 1083.3);
    const cx = wx(394.55), cz = wz(1072.2), w = 85.5 * S, d = 22.2 * S;
    box(staticRoot, w, .88, d, M.sinkCab, cx, .44, cz);
    box(staticRoot, w + .02, .04, d + .02, M.deskTop, cx, .9, cz);
    box(staticRoot, .55, .03, .4, M.steel, wx(370.3), .925, cz, false);
    cyl(staticRoot, .02, .02, .3, M.steel, wx(370.3), 1.07, cz + .26, 8);
    box(staticRoot, .03, .03, .16, M.steel, wx(370.3), 1.21, cz + .19);
    mkSpot('sink', 374, 1049, SO, { place: 'the sink' }); mkSpot('sink', 408, 1049, SO, { place: 'the sink' });
  }
  // Snack cabinet on the wall above the sink, with a spot in front to grab something from it
  {
    const cx = wx(392), cz = wz(1083.3) - .2, w = 1.3;
    box(staticRoot, w, .62, .36, M.sinkCab, cx, 1.78, cz);
    [-1, 1].forEach(s => { box(staticRoot, w / 2 - .03, .56, .02, M.deskTop, cx + s * w / 4, 1.78, cz - .19, false); box(staticRoot, .02, .14, .03, M.steel, cx + s * .05, 1.7, cz - .2, false); });
    mkSpot('snack', 391, 1049, SO, { place: 'the snack cabinet' });
  }
  // (the bucket by the counter, and its spot, come in step 2 of phase 6 with the bucket run)
}

export { buildKitchen };
