import * as THREE from 'three';
import { wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { box, dynamic, frame } from '../helpers.js';

// The TV on the back of the booths, facing south over the dining area toward the kitchen. It hangs on its own
// full-height panel so it stays up when the walls are lowered. While someone watches (a TV break, or lunch at
// the dining tables) it plays a short animated movie; otherwise a standby screen.
const TV_X = 582, BOOTH_BACK = 938.7; // plan pixels: centre of the TV, south face of the booths' back wall
const tvState = { canvas: null, tex: null, t: 0, acc: 0, watching: false };
let DINING_TV_POS = null;

const SUBTITLES = [
  'Are we there yet?', 'Just one more hill.', 'Look, the sun is setting.', 'Did anyone pack snacks?',
  'Turn left at the windmill.', 'This road goes on forever.', 'Best road trip ever.', 'Wake me up when we arrive.',
];

function drawStandby(g, w, h) {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#16212b'); gr.addColorStop(1, '#22313c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5ab5d8'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('MOVIE BREAK', w / 2, h / 2 - 4);
  g.fillStyle = '#93a3ae'; g.font = '12px sans-serif'; g.fillText('Lunch · 15:00 · 17:00', w / 2, h / 2 + 18); g.textAlign = 'left';
}

// An original little movie: a car drives through rolling hills at sunset, with subtitles.
function drawMovie(g, w, h, t) {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#2b2e6b'); sky.addColorStop(.55, '#f08a5d'); sky.addColorStop(1, '#f9c46b');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe7a3'; g.beginPath(); g.arc(w * .7, h * .52 + Math.sin(t * .05) * 4, 22, 0, Math.PI * 2); g.fill();
  const hills = (color, base, amp, speed, len) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + Math.sin((x + t * speed) / len) * amp + Math.sin((x + t * speed) / (len * .37)) * amp * .3);
    g.lineTo(w, h); g.fill();
  };
  hills('#8a4f7d', h * .62, 10, 8, 60); hills('#5b3a6b', h * .7, 12, 18, 45); hills('#2f2440', h * .8, 8, 40, 35);
  // the car, bobbing along the road
  const cx = w * .38, cy = h * .79 + Math.abs(Math.sin(t * 6)) * 1.5;
  g.fillStyle = '#c8302c'; g.fillRect(cx - 24, cy - 12, 48, 10); g.fillRect(cx - 12, cy - 20, 26, 9);
  g.fillStyle = '#9fd0e4'; g.fillRect(cx - 9, cy - 18, 9, 6); g.fillRect(cx + 2, cy - 18, 9, 6);
  g.fillStyle = '#1b1f24'; [-14, 14].forEach(dx => { g.beginPath(); g.arc(cx + dx, cy - 1, 5, 0, Math.PI * 2); g.fill(); });
  // letterbox and subtitles
  g.fillStyle = '#000'; g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16);
  const line = SUBTITLES[Math.floor(t / 4) % SUBTITLES.length];
  g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#fff';
  g.strokeText(line, w / 2, h - 24); g.fillText(line, w / 2, h - 24); g.textAlign = 'left';
}

function buildDiningTv() {
  const z = wz(BOOTH_BACK), f = frame(TV_X, BOOTH_BACK, 0); // faces south
  const panelW = 2.4, tvW = 2.0, tvH = tvW * .5625, yc = 1.75;
  box(f, panelW, 2.4, .04, M.booth, 0, 1.2, .02);                       // full-height panel on the booth wall
  box(f, panelW + .02, .04, .07, M.boothFrame, 0, 2.42, .03, false);
  box(f, tvW + .05, tvH + .05, .05, M.monitor, 0, yc, .08);            // the TV
  box(f, .3, .3, .04, M.chairBase, 0, yc, .05, false);                  // wall bracket
  tvState.canvas = document.createElement('canvas'); tvState.canvas.width = 320; tvState.canvas.height = 180;
  drawStandby(tvState.canvas.getContext('2d'), 320, 180);
  tvState.tex = new THREE.CanvasTexture(tvState.canvas); tvState.tex.colorSpace = THREE.SRGBColorSpace;
  const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(tvW - .03, tvH - .03), new THREE.MeshBasicMaterial({ map: tvState.tex, toneMapped: false })));
  scr.position.set(0, yc, .108); f.add(scr);
  DINING_TV_POS = new THREE.Vector3(wx(TV_X), yc, z + .1);
}

// Per frame from the loop: play the movie while someone is watching (redrawn about 20 times a second).
function updateDiningTv(dt, watching) {
  if (!tvState.canvas) return;
  const g = tvState.canvas.getContext('2d');
  if (!watching) { if (tvState.watching) { drawStandby(g, 320, 180); tvState.tex.needsUpdate = true; } tvState.watching = false; return; }
  tvState.watching = true; tvState.t += dt; tvState.acc += dt;
  if (tvState.acc < .05) return;
  tvState.acc = 0; drawMovie(g, 320, 180, tvState.t); tvState.tex.needsUpdate = true;
}

export { DINING_TV_POS, buildDiningTv, updateDiningTv };
