import * as THREE from 'three';
import { wx, wz } from '../../config/plan.js';
import { canvasTex, M } from '../../render/materials.js';
import { E, mkSpot } from './basics.js';
import { addObs, box, dynamic, frame } from '../helpers.js';

// Whiteboards against the east wall, each beside one of the work-floor TVs (workfloor.js), with the open
// floor in front for the discussion. Each has three standing spots (group 'wb<n>'): whoever starts a
// discussion takes the first and presents, colleagues take the others.
const BOARDS = [[672, 453], [672, 677]]; // plan pixels: board centre (it faces west, into the office)
const BOARD_WHITE = '#fbfcfd';
// The writing surfaces, which you can draw on in first person (ui/interact.js): { mesh, canvas, tex }.
const SURFACES = [];

const boardMat = () => new THREE.MeshStandardMaterial({ roughness: .35, map: canvasTex(512, 320, (g, w, h) => {
  g.fillStyle = BOARD_WHITE; g.fillRect(0, 0, w, h);
  g.scale(2, 2); // the doodle is drawn at half size
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
    const mat = boardMat(), mesh = dynamic(box(f, 1.4, .9, .03, mat, 0, 1.45, 0)); // not baked: it is drawn on
    SURFACES.push({ mesh, canvas: mat.map.image, tex: mat.map });
    box(f, 1.46, .04, .05, M.steel, 0, 1.92, 0); box(f, 1.46, .04, .05, M.steel, 0, .98, 0);
    box(f, 1.2, .03, .08, M.steel, 0, 1.0, .05, false); // marker tray
    [-1, 1].forEach(s => { box(f, .04, 1.9, .04, M.steel, s * .7, .95, 0); box(f, .06, .03, .5, M.steel, s * .7, .02, 0); });
    const g = `wb${i}`;
    mkSpot('whiteboard', px - 13, py + 8, E, { place: 'the whiteboard', group: g });       // presenter, by the board
    mkSpot('whiteboard', px - 34, py - 14, E, { place: 'the whiteboard', group: g });
    mkSpot('whiteboard', px - 34, py + 20, E, { place: 'the whiteboard', group: g });
  });
}

// A stroke on a board's front from one point to the next (0-1 across, 0-1 down); an eraser stroke is board white.
function boardStroke(b, u0, v0, u1, v1, color, width) {
  const g = b.canvas.getContext('2d'), w = b.canvas.width, h = b.canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = color ?? BOARD_WHITE; g.lineWidth = width; g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.moveTo(u0 * w, v0 * h); g.lineTo(u1 * w, v1 * h); g.stroke();
  b.tex.needsUpdate = true;
}
// Wipe a board clean.
function clearBoard(b) {
  const g = b.canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = BOARD_WHITE; g.fillRect(0, 0, b.canvas.width, b.canvas.height);
  b.tex.needsUpdate = true;
}

const WHITEBOARD_COUNT = BOARDS.length;

export { SURFACES, WHITEBOARD_COUNT, boardStroke, buildWhiteboards, clearBoard };
