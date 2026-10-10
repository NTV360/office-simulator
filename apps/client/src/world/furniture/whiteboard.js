import * as THREE from 'three';
import { seededRandom } from '@office/shared';
import { canvasTex, M } from '../../render/materials.js';
import { E, mkSpot } from './basics.js';
import { box } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';

// Whiteboards against the east wall, each beside one of the work-floor TVs (workfloor.js), with the open
// floor in front for the discussion. Each has three standing spots (group 'wb<n>'): whoever starts a
// discussion takes the first and presents, colleagues take the others.
const BOARDS = [[672, 453], [672, 677]]; // plan pixels: board centre (it faces west, into the office)

// (the scribbles are made from the board's number, so every browser draws the same ones)
const boardMat = i => new THREE.MeshStandardMaterial({ roughness: .35, map: canvasTex(256, 160, (g, w, h) => {
  const rng = seededRandom(i * 131 + 7);
  g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h);
  g.lineWidth = 3; g.lineCap = 'round';
  for (const [c, y] of [['#2f6fd6', 30], ['#c8302c', 70], ['#2a8a4a', 110]]) {
    g.strokeStyle = c; g.beginPath(); g.moveTo(20, y);
    for (let x = 20; x < 150 + rng() * 80; x += 12) g.lineTo(x, y + Math.sin(x * .3) * 4);
    g.stroke();
  }
  g.strokeStyle = '#25323d'; g.strokeRect(160, 22, 70, 46); g.beginPath(); g.moveTo(195, 68); g.lineTo(195, 120); g.stroke();
}) });

/** Whiteboard number `i` drawn at the origin of `g`, facing +z: the board, its frame, the marker tray, the legs and feet. */
const boardMats = [];
function drawWhiteboard(f, i) {
  boardMats[i] ??= boardMat(i);
  box(f, 1.4, .9, .03, boardMats[i], 0, 1.45, 0);
  box(f, 1.46, .04, .05, M.steel, 0, 1.92, 0); box(f, 1.46, .04, .05, M.steel, 0, .98, 0);
  box(f, 1.2, .03, .08, M.steel, 0, 1.0, .05, false); // marker tray
  [-1, 1].forEach(s => { box(f, .04, 1.9, .04, M.steel, s * .7, .95, 0); box(f, .06, .03, .5, M.steel, s * .7, .02, 0); });
}
// A whiteboard is an item that carries its three standing spots: wheel it elsewhere and the discussion happens there.
function buildWhiteboards() {
  BOARDS.forEach(([px, py], i) => {
    const g = `wb${i}`;
    const ids = [
      mkSpot('whiteboard', px - 13, py + 8, E, { place: 'the whiteboard', group: g }),       // presenter, by the board
      mkSpot('whiteboard', px - 34, py - 14, E, { place: 'the whiteboard', group: g }),
      mkSpot('whiteboard', px - 34, py + 20, E, { place: 'the whiteboard', group: g }),
    ].map(s => s.id);
    placeLater(() => placeObject('whiteboard', px, py, -Math.PI / 2, { variant: i, spot: ids[0], spots: ids.slice(1) })); // (facing west)
  });
}

const WHITEBOARD_COUNT = BOARDS.length;

export { WHITEBOARD_COUNT, buildWhiteboards, drawWhiteboard };
