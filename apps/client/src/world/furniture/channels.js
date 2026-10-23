import * as THREE from 'three';
import { SCREENS, movieAt } from '../../render/screens.js';
import { awardsScreen } from './awards.js';
import { diningScreen, drawMovie } from './diningTv.js';
import { gameMat } from './game.js';
import { TV_SCREENS } from './tv.js';

// TV channels: walking around, aim at any TV and change what it shows (ui/interact.js). Channel 0 is the TV's own
// programme (its slides or dashboards, the lounge's game and awards, the dining area's movie); the others are the
// same on every TV. A tuned TV gets its channel's picture every frame (updateChannels, after the TVs' own updates).
const CHANNELS = [
  { name: 'Office' },
  { name: 'Road trip movie', kind: 'movie' },
  { name: 'Fight game', kind: 'game' },
  { name: 'Office awards', kind: 'awards' },
  { name: 'Cartoon', kind: 'film', film: 0 },
  { name: 'Drama', kind: 'film', film: 1 },
  { name: 'Off', kind: 'off' },
];
const tvs = []; // { mesh, base (its own picture, for channel 0), ch }
const movie = { canvas: null, tex: null, mat: null, t: 0, acc: 0 }; // the road trip movie's own copy
let filmT = 0;

// After the furniture is built: every TV screen.
function initChannels() {
  for (const mesh of [...TV_SCREENS, diningScreen]) tvs.push({ mesh, base: mesh.material, ch: 0 });
}
const tvScreens = () => tvs.map(t => t.mesh);
const tvOf = mesh => tvs.find(t => t.mesh === mesh) ?? null;
const channelName = t => CHANNELS[t.ch].name;
// Switch a TV to its next channel; returns the channel's name.
function nextChannel(t) {
  t.ch = (t.ch + 1) % CHANNELS.length;
  if (t.ch === 0) t.mesh.material = t.base; // its own programme (the lounge and the classroom update theirs)
  return channelName(t);
}
// Whether any TV is tuned to this kind of channel (main.js keeps the fight game playing for it).
function onAir(kind) { for (const t of tvs) if (CHANNELS[t.ch].kind === kind) return true; return false; }

function playMovie(dt) {
  if (!movie.mat) {
    movie.canvas = document.createElement('canvas'); movie.canvas.width = 320; movie.canvas.height = 180;
    movie.tex = new THREE.CanvasTexture(movie.canvas); movie.tex.colorSpace = THREE.SRGBColorSpace;
    movie.mat = new THREE.MeshBasicMaterial({ map: movie.tex, toneMapped: false });
  }
  movie.t += dt; movie.acc += dt;
  if (movie.acc < .05) return; // about 20 frames a second
  movie.acc = 0; drawMovie(movie.canvas.getContext('2d'), 320, 180, movie.t); movie.tex.needsUpdate = true;
}
// Per frame: tuned TVs show their channel.
function updateChannels(dt) {
  if (onAir('movie')) playMovie(dt);
  if (onAir('film')) filmT += dt;
  for (const t of tvs) {
    const c = CHANNELS[t.ch]; if (!c.kind) continue;
    const m = c.kind === 'movie' ? movie.mat : c.kind === 'game' ? gameMat : c.kind === 'awards' ? awardsScreen() : c.kind === 'film' ? movieAt(c.film, filmT) : SCREENS.off;
    if (t.mesh.material !== m) t.mesh.material = m;
  }
}

export { channelName, initChannels, nextChannel, onAir, tvOf, tvScreens, updateChannels };
