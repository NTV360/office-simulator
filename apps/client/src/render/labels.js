import * as THREE from 'three';
import { toPx, wx, wz } from '@office/shared';
import { scene } from './renderer.js';
import { ISLANDS } from '../world/furniture/desks.js';

/* ================= Labels ================= */
const labelGroup = new THREE.Group();
const labelState = { on: true };
function label(text, px, py, y = 3.0, scale = 1) {
  const c = document.createElement('canvas'); let g = c.getContext('2d');
  const font = '600 38px Archivo, "Helvetica Neue", Arial, sans-serif', track = 5;
  const str = text.toUpperCase();
  const setup = () => { g.font = font; g.textBaseline = 'middle'; if ('letterSpacing' in g) g.letterSpacing = track + 'px'; };
  setup();
  // measure with the same tracking we draw with; fall back to adding it by hand
  let tw = g.measureText(str).width; if (!('letterSpacing' in g)) tw += track * str.length;
  c.width = Math.ceil(tw + 64); c.height = 70; g = c.getContext('2d'); setup();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.roundRect(2, 2, c.width - 4, 66, 33); g.fill();
  g.strokeStyle = 'rgba(37,50,61,.18)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#25323d';
  if ('letterSpacing' in g) g.fillText(str, 32 + track / 2, 37);
  else { let x = 32; for (const ch of str) { g.fillText(ch, x, 37); x += g.measureText(ch).width + track; } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  const h = .55 * scale; sp.scale.set(h * c.width / c.height, h, 1); sp.position.set(wx(px), y, wz(py)); sp.renderOrder = 10;
  labelGroup.add(sp);
}
function buildLabels() {
  ISLANDS.forEach(d => { const [px, py] = toPx(new THREE.Vector3(d.cx, 0, d.cz)); label(d.name, px, py, 1.7); });
  label('Conference 1 (CTOs)', 190, 132, 2.9, .9); label('Conference 2 (HR)', 330, 132, 2.9, .9); label('Conference 3', 168, 248, 2.9, .85);
  label('Lounge', 168, 345, 1.8, .85); label('TV lounge', 362, 318, 1.9, .85); label('Entrance', 223, 440, 1.2);
  label('Bar table', 450, 105, 1.7, .75); label('Bar table', 655, 207, 1.7, .75);
  label('Booths', 582, 916, 2.9); label('Dining area', 544, 1030, 2.1); label('Mini golf', 667, 1018, 1.5, .8); label('Darts', 380, 925, 2.8, .8); label('Music corner', 655, 538, 2.0, .8);
  label('Counter top', 390, 1014, 1.8, .8); label('Sink', 395, 1072, 1.6, .8); label('Storage', 311, 1062, 2.4, .85); label('Locker 2', 508, 1103, 2.4, .8); label('Locker 1', 615, 1103, 2.4, .8);
}


function initLabels() {
  scene.add(labelGroup);
}

export { buildLabels, labelGroup, labelState, initLabels };
