import * as THREE from 'three';
import { wx, wz } from '../../config/plan.js';
import { canvasTex, M } from '../../render/materials.js';
import { E, mkSpot } from './basics.js';
import { addObs, box, frame } from '../helpers.js';

// Whiteboards against the east wall, each beside one of the work-floor TVs (workfloor.js), with the open
// floor in front for the discussion. Each has three standing spots (group 'wb<n>'): whoever starts a
// discussion takes the first and presents, colleagues take the others.
const BOARDS = [[672, 453], [672, 677]]; // plan pixels: board centre (it faces west, into the office)

const boardMat = () => new THREE.MeshStandardMaterial({ roughness: .35, map: canvasTex(256, 160, (g, w, h) => {
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
  g.lineWidth = 3; g.lineCap = 'round';
  for (const [c, y] of [['#2f6fd6', 30], ['#c8302c', 70], ['#2a8a4a', 110]]) {
    g.strokeStyle = c; g.beginPath(); g.moveTo(20, y);
    for (let x = 20; x < 150 + Math.random() * 80; x += 12) g.lineTo(x, y + Math.sin(x * .3) * 4);
    g.stroke();
  }
  g.strokeStyle = '#25323d'; g.strokeRect(160, 22, 70, 46); g.beginPath(); g.moveTo(195, 68); g.lineTo(195, 120); g.stroke();
}) });

function buildWhiteboards() {
  BOARDS.forEach(([px, py], i) => {
    addObs(px - 2, py - 17, px + 2, py + 17);
    const f = frame(px, py, -Math.PI / 2); // facing west
    box(f, 1.4, .9, .03, boardMat(), 0, 1.45, 0);
    box(f, 1.46, .04, .05, M.steel, 0, 1.92, 0); box(f, 1.46, .04, .05, M.steel, 0, .98, 0);
    box(f, 1.2, .03, .08, M.steel, 0, 1.0, .05, false); // marker tray
    [-1, 1].forEach(s => { box(f, .04, 1.9, .04, M.steel, s * .7, .95, 0); box(f, .06, .03, .5, M.steel, s * .7, .02, 0); });
    const g = `wb${i}`;
    mkSpot('whiteboard', px - 13, py + 8, E, { place: 'the whiteboard', group: g });       // presenter, by the board
    mkSpot('whiteboard', px - 34, py - 14, E, { place: 'the whiteboard', group: g });
    mkSpot('whiteboard', px - 34, py + 20, E, { place: 'the whiteboard', group: g });
  });
}

const WHITEBOARD_COUNT = BOARDS.length;

export { WHITEBOARD_COUNT, buildWhiteboards };
