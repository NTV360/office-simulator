import * as THREE from 'three';
import { WALL_T } from '../../config/plan.js';
import { M } from '../../render/materials.js';
import { E } from './basics.js';
import { addObs, box, boxGeo, frame } from '../helpers.js';

// Wall-mounted server cabinet (replaces the plant by the column wall)
const SERVER_LEDS = [];


function buildServer() {
  {
    const bx = 351.8 + WALL_T / 2;
    addObs(bx, 852, bx + 14, 880);
    const f = frame(bx + .4, 866, E);
    box(f, .1, 2.6, .05, M.white, -.38, 1.3, -.01);           // cable duct to the floor
    box(f, .62, .72, .5, M.rack, 0, 1.55, .25);                // cabinet body
    box(f, .56, .66, .01, M.rackGlass, 0, 1.55, .505);         // smoked glass door
    for (let i = 0; i < 6; i++) {
      box(f, .5, .07, .02, M.monitor, 0, 1.3 + i * .095, .48);
      for (let k = 0; k < 3; k++) {
        const led = new THREE.Mesh(boxGeo(.012, .012, .01), new THREE.MeshBasicMaterial({ color: k === 2 ? 0x5ab5ff : 0x55e07a }));
        led.position.set(.17 + k * .025, 1.3 + i * .095, .495); led.userData.dynamic = true; f.add(led); SERVER_LEDS.push(led);
      }
    }
    box(f, .03, .12, .02, M.steel, .25, 1.55, .515);           // door handle
    for (let i = 0; i < 4; i++) box(f, .014, .3 + i * .1, .014, [M.golfBlue, M.flag, M.golfBallY, M.white][i], -.2 + i * .04, 1.05 - i * .05, .2);  // patch cables
  }
}

export { SERVER_LEDS, buildServer };
