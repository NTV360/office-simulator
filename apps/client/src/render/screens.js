import { LESSONS, SCREEN_VARIANTS } from '@office/shared';
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
// A movie (Hazel's, see people/hazel.js): letterboxed dusk over hills, two figures, a subtitle and the player's
// progress bar. Frame `i` of a few moves the figures and the light a little so it looks like it is playing.
function movieScreen(i) {
  return canvasTex(256, 144, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const sky = g.createLinearGradient(0, 16, 0, h - 16); sky.addColorStop(0, ['#2b2350', '#352a5c', '#3f2f60', '#352a5c'][i]); sky.addColorStop(1, ['#e8875b', '#ef9a62', '#f2a96a', '#ef9a62'][i]);
    g.fillStyle = sky; g.fillRect(0, 16, w, h - 32);
    g.fillStyle = '#ffe2a8'; g.beginPath(); g.arc(180, 86 - i * 2, 16, 0, TAU); g.fill();
    g.fillStyle = '#2a2140'; g.beginPath(); g.moveTo(0, 104); for (let x = 0; x <= w; x += 16) g.lineTo(x, 96 - Math.sin(x / 40) * 12); g.lineTo(w, 128); g.lineTo(0, 128); g.fill();
    g.fillStyle = '#120d1c';
    [[90 + i * 3, 0], [118 - i * 2, 4]].forEach(([x, d]) => { g.fillRect(x, 82 + d, 8, 22 - d); g.beginPath(); g.arc(x + 4, 78 + d, 5, 0, TAU); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(78, 112, 100, 4);
    g.fillStyle = '#e04848'; g.fillRect(8, h - 8, 70 + i * 4, 3); g.fillStyle = '#555'; g.fillRect(78 + i * 4, h - 8, w - 86 - i * 4, 3);
  });
}
const screenMat = t => new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
const SCREENS = {
  code: Array.from({ length: SCREEN_VARIANTS.code }, () => screenMat(codeScreen())),
  design: Array.from({ length: SCREEN_VARIANTS.design }, () => screenMat(designScreen())),
  dash: Array.from({ length: SCREEN_VARIANTS.dash }, () => screenMat(dashScreen())),
  movie: [0, 1, 2, 3].map(i => screenMat(movieScreen(i))),
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
// Coding classes in Conference 1 (sim/meetings.ts): each lesson's code (the shared LESSONS) on the room's TV while it runs.
function lessonScreen({ title, code }) {
  return canvasTex(512, 288, (g, w, h) => {
    g.fillStyle = '#141b22'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f8db3'; g.fillRect(0, 0, w, 40);
    g.fillStyle = '#ffffff'; g.font = '700 20px Archivo, "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText(`Coding class · ${title}`, 18, 21);
    g.font = '17px Menlo, Consolas, monospace';
    code.forEach((line, i) => {
      const y = 70 + i * 30;
      g.fillStyle = '#4d5b68'; g.fillText(String(i + 1).padStart(2, ' '), 14, y);
      g.fillStyle = /^\s*(\/\/|#|--)/.test(line) ? '#7d8b97' : ['#9ad19a', '#e8a87c', '#7fb4e8', '#d6dde3'][i % 4];
      g.fillText(line, 52, y);
    });
  });
}
const TV_MATS = { slides: [0, 1, 2].map(i => screenMat(slidesScreen(i))), dash: SCREENS.dash, lesson: LESSONS.map(l => screenMat(lessonScreen(l))) };

// The movies on Hazel's monitor: the files below in public/movies/ that are there (a gif plays, a still image
// just shows), else the drawn one above. Loaded once at start (bootstrap.js); each sitting she picks one.
const MOVIE_FILES = ['movies/images1.jpeg', 'movies/images2.jpeg']; // the cartoon, the drama
const movies = [];
// A file's frames as bitmaps with their start times (null: missing). Gifs are decoded frame by frame with the
// browser's ImageDecoder; without it (or for a still) the file is one frame.
async function loadMovie(url) {
  const r = await fetch(url), type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) return null; // the dev server answers a missing file with the page
  const frames = []; let total = 0;
  if (type.includes('gif') && 'ImageDecoder' in window) {
    const dec = new ImageDecoder({ data: r.body, type });
    await dec.tracks.ready;
    for (let i = 0; i < dec.tracks.selectedTrack.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      frames.push({ bmp: await createImageBitmap(image), at: total }); total += (image.duration || 1e5) / 1e6; // microseconds; 0.1 s when unset
      image.close();
    }
  } else { frames.push({ bmp: await createImageBitmap(await r.blob()), at: 0 }); total = 1; }
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; // the monitor's 16:9; frames are cropped to fill it
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return { frames, total, shown: -1, ctx: c.getContext('2d'), tex, mat: screenMat(tex) };
}
async function initMovie() {
  for (const f of MOVIE_FILES) {
    try { const m = await loadMovie(import.meta.env.BASE_URL + f); if (m) movies.push(m); }
    catch (err) { console.warn(`Hazel's movie ${f} could not be loaded`, err); }
  }
}
// Draw an image to fill the canvas, cropping what doesn't fit (centred).
function cover(g, img) {
  const { width: w, height: h } = g.canvas, k = Math.max(w / img.width, h / img.height);
  g.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
}
// Movie number `n` (any integer; wraps) at `t` seconds in, as a screen material.
function movieAt(n, t) {
  if (!movies.length) return SCREENS.movie[Math.floor(t / .5) % SCREENS.movie.length];
  const m = movies[n % movies.length], at = t % m.total, i = m.frames.findLastIndex(f => f.at <= at);
  if (i !== m.shown) { m.shown = i; cover(m.ctx, m.frames[i].bmp); m.tex.needsUpdate = true; }
  return m.mat;
}


// The mesh that shows each desk's monitor, by spot id. The simulation only says what a screen shows (see screenState);
// the client looks the mesh up here.
const deskScreens = new Map();
const registerScreen = (spotId, mesh) => deskScreens.set(spotId, mesh);
/** Remove a screen registration when its owning monitor tombstone is consumed. */
const unregisterScreen = (spotId, mesh) => {
  if (deskScreens.get(spotId) === mesh || mesh === undefined) deskScreens.delete(spotId);
};

export { SCREENS, TV_MATS, deskScreens, initMovie, movieAt, registerScreen, unregisterScreen };
