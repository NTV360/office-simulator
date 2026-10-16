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
const tvs = []; // { mesh, base (its own picture, for channel 0), ch, song (the song playing on it, ui/games.js) }
const movie = { canvas: null, tex: null, mat: null, t: 0, acc: 0 }; // the road trip movie's own copy
const music = { canvas: null, tex: null, mat: null, t: 0, acc: 0 };  // the song playing: its name and bars to the beat
let filmT = 0;

// After the furniture is built: every TV screen.
function initChannels() {
  for (const mesh of [...TV_SCREENS, diningScreen]) tvs.push({ mesh, base: mesh.material, ch: 0 });
}
const tvScreens = () => tvs.map(t => t.mesh);
const tvOf = mesh => tvs.find(t => t.mesh === mesh) ?? null;
const channelName = t => CHANNELS[t.ch].name;
// Switch a TV to its next channel (or the one before, dir -1); returns the channel's name.
function nextChannel(t, dir = 1) {
  t.ch = (t.ch + dir + CHANNELS.length) % CHANNELS.length;
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
// A song on a TV (null stops it): { name, bpm }. It shows over whatever channel the TV is on.
function playOnTv(t, song) { t.song = song; if (!song) t.mesh.material = t.base; }
function drawMusic(dt, s) {
  if (!music.mat) {
    music.canvas = document.createElement('canvas'); music.canvas.width = 320; music.canvas.height = 180;
    music.tex = new THREE.CanvasTexture(music.canvas); music.tex.colorSpace = THREE.SRGBColorSpace;
    music.mat = new THREE.MeshBasicMaterial({ map: music.tex, toneMapped: false });
  }
  music.t += dt; music.acc += dt; if (music.acc < .05) return; music.acc = 0;
  const g = music.canvas.getContext('2d'), w = 320, h = 180, beat = music.t * s.bpm / 60, pulse = Math.exp(-(beat % 1) * 4);
  const sky = g.createLinearGradient(0, 0, w, h); sky.addColorStop(0, '#1b1340'); sky.addColorStop(1, '#3a1f4f'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 24; i++) { // bars to the beat
    const v = .25 + .55 * Math.abs(Math.sin(music.t * (1.3 + i * .37) + i)) * (.6 + .4 * pulse), bh = v * 90;
    g.fillStyle = `hsl(${280 + i * 4}, 80%, ${55 + pulse * 15}%)`; g.fillRect(16 + i * 12, 130 - bh, 8, bh);
  }
  g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.fillText('♪ ' + s.name, w / 2, 158);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '11px sans-serif'; g.fillText('Now playing in the TV lounge', w / 2, 24); g.textAlign = 'left';
  music.tex.needsUpdate = true;
}
// Per frame: tuned TVs show their channel, and a TV playing a song its music.
function updateChannels(dt) {
  for (const t of tvs) if (t.song) { drawMusic(dt, t.song); if (t.mesh.material !== music.mat) t.mesh.material = music.mat; }
  if (onAir('movie')) playMovie(dt);
  if (onAir('film')) filmT += dt;
  for (const t of tvs) {
    const c = CHANNELS[t.ch]; if (!c.kind || t.song) continue;
    const m = c.kind === 'movie' ? movie.mat : c.kind === 'game' ? gameMat : c.kind === 'awards' ? awardsScreen() : c.kind === 'film' ? movieAt(c.film, filmT) : SCREENS.off;
    if (t.mesh.material !== m) t.mesh.material = m;
  }
}

export { channelName, initChannels, nextChannel, onAir, playOnTv, tvOf, tvScreens, updateChannels };
