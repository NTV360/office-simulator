import { SCREEN_VARIANTS } from '@office/shared';
import * as THREE from 'three';
import { TAU, vpick } from '@office/shared';
import { canvasTex } from './materials.js';

/* Monitor screens: code, design files, dashboards, lock screen */
const CODE_COLS = ['#7fb4e8', '#e8a87c', '#9ad19a', '#c79be0', '#d6dde3', '#e6d27a', '#6fd0c8'];
function codeScreen() {
  return canvasTex(256, 144, (g, w, h) => {
    g.fillStyle = '#121c26'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a2733'; g.fillRect(0, 0, 44, h); g.fillRect(0, 0, w, 10);
    let y = 18, ind = 0;
    while (y < h - 6) {
      ind = Math.max(0, Math.min(4, ind + vpick([-1, 0, 0, 1])));
      let x = 52 + ind * 12;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n && x < w - 10; k++) { const len = 10 + Math.random() * 46; g.fillStyle = vpick(CODE_COLS); g.fillRect(x, y, len, 4); x += len + 6; }
      y += 9;
    }
  });
}
function designScreen() {
  return canvasTex(256, 144, (g, w, h) => {
    g.fillStyle = '#eef0f3'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 40, h); g.fillRect(w - 50, 0, 50, h);
    g.fillStyle = '#ffffff'; g.fillRect(58, 18, 130, 108);
    g.fillStyle = vpick(['#2f8db3', '#d9694f', '#5b8f6c', '#7a6aa3']); g.fillRect(66, 26, 114, 34);
    g.fillStyle = '#c9d2da'; for (let i = 0; i < 4; i++) g.fillRect(66, 68 + i * 12, 60 + Math.random() * 50, 5);
    g.fillStyle = '#e2b65c'; g.fillRect(66, 112, 40, 8);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#d4dbe1'; g.fillRect(6, 10 + i * 14, 28, 6); g.fillRect(w - 44, 10 + i * 14, 38, 6); }
  });
}
function dashScreen() {
  return canvasTex(256, 144, (g, w, h) => {
    g.fillStyle = '#10171e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) { g.fillStyle = '#1b2731'; g.fillRect(8 + i * 82, 8, 76, 34); g.fillStyle = vpick(['#6fd0c8', '#9ad19a', '#e6d27a']); g.fillRect(14 + i * 82, 26, 30 + Math.random() * 30, 8); }
    g.strokeStyle = '#5ab5d8'; g.lineWidth = 2; g.beginPath();
    for (let x = 8; x < w - 8; x += 8) g.lineTo(x, 110 - Math.random() * 40 - Math.sin(x / 30) * 12); g.stroke();
    g.strokeStyle = '#e8875b'; g.beginPath();
    for (let x = 8; x < w - 8; x += 8) g.lineTo(x, 125 - Math.random() * 20); g.stroke();
  });
}
const screenMat = t => new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
const SCREENS = {
  code: Array.from({ length: SCREEN_VARIANTS.code }, () => screenMat(codeScreen())),
  design: Array.from({ length: SCREEN_VARIANTS.design }, () => screenMat(designScreen())),
  dash: Array.from({ length: SCREEN_VARIANTS.dash }, () => screenMat(dashScreen())),
  lock: screenMat(canvasTex(128, 72, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#24465c'); gr.addColorStop(1, '#3b6f7f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(w / 2, 30, 9, 0, TAU); g.fill(); g.fillRect(w / 2 - 18, 46, 36, 4); })),
  off: new THREE.MeshBasicMaterial({ color: 0x0c1014 }),
};

function slidesScreen(i) {
  return canvasTex(320, 180, (g, w, h) => {
    g.fillStyle = '#f6f4ef'; g.fillRect(0, 0, w, h);
    g.fillStyle = ['#2f8db3', '#d9694f', '#5b8f6c'][i % 3]; g.fillRect(0, 0, w, 34);
    g.fillStyle = '#ffffff'; g.fillRect(16, 12, 120, 10);
    g.fillStyle = '#c9d2da'; for (let k = 0; k < 4; k++) g.fillRect(20, 54 + k * 22, 100 + Math.random() * 60, 8);
    const bw = 18; for (let k = 0; k < 5; k++) { const bh = 30 + Math.random() * 70; g.fillStyle = k === 3 ? '#e2b65c' : '#3e6e9c'; g.fillRect(200 + k * (bw + 6), 160 - bh, bw, bh); }
  });
}
const TV_MATS = { slides: [0, 1, 2].map(i => screenMat(slidesScreen(i))), dash: SCREENS.dash };

// The mesh that shows each desk's monitor, by spot id. The simulation only says what a screen shows (see screenState);
// the client looks the mesh up here.
const deskScreens = new Map();
const registerScreen = (spotId, mesh) => deskScreens.set(spotId, mesh);

export { SCREENS, TV_MATS, deskScreens, registerScreen };
