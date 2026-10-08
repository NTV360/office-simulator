import * as THREE from 'three';
import { W } from '../../config/plan.js';
import { TAU, vpick, vrnd } from '../../core/util.js';
import { M } from '../../render/materials.js';
import { E } from './basics.js';
import { tv } from './tv.js';
import { addObs, box, boxGeo, frame } from '../helpers.js';
import { interactables } from '../interactables.js';
let gameT = 0, gameAcc = 0;
const FIGHTERS = [
  { name: 'KAI', skin: '#d9a27a', top: '#2f6fb3', pants: '#1d2733', hair: '#1b1817', belt: '#e2b65c' },
  { name: 'ROSA', skin: '#f0c9a4', top: '#c8403a', pants: '#2b2230', hair: '#5a2a1d', belt: '#f2f2f2' },
];
const fightState = { hp: [1, 1], round: 1, wins: [0, 0], ko: 0, x: [110, 210], move: ['idle', 'idle'], mt: [0, 0], spark: null, shake: 0, clock: 60, nextAct: .6 };
function fighterPose(move, t) {
  // direct limb angles: 0 = straight down, π/2 = pointing forward, π = straight up
  const bob = Math.sin(gameT * 6) * .06;
  const guard = { ua1: 1.05 + bob, fa1: 2.55, ua2: .8 - bob, fa2: 2.45, th1: .42, sh1: .02, th2: -.45, sh2: -.12, lean: .08, cr: 4 + Math.abs(bob) * 18 };
  const k = d => Math.sin(Math.min(1, t / d) * Math.PI);
  switch (move) {
    case 'punch': { const q = k(.25); return { ...guard, ua1: 1.05 + .5 * q, fa1: 2.55 - 1.0 * q, lean: .08 + .14 * q }; }
    case 'kick': { const q = k(.35); return { ...guard, th1: .42 + 1.2 * q, sh1: .02 + 1.5 * q, th2: -.3, lean: .08 - .35 * q, cr: 2 }; }
    case 'uppercut': { const q = Math.min(1, t / .35); return { ...guard, ua1: .5 + 2.3 * q, fa1: 2.4 + .6 * q, lean: .2 - .3 * q, cr: 10 * (1 - q) - 3 * Math.sin(q * Math.PI) }; }
    case 'hit': { const q = Math.max(0, 1 - t / .45); return { ...guard, ua1: .5, fa1: 1.2, ua2: .2, fa2: .9, lean: .08 - .5 * q, cr: 4 }; }
    case 'block': return { ...guard, ua1: 1.35, fa1: 3.0, ua2: 1.2, fa2: 2.95, lean: -.04, cr: 6 };
    case 'ko': return { ua1: 2.2, fa1: 2.6, ua2: 2.4, fa2: 2.8, th1: 1.45, sh1: 1.5, th2: 1.3, sh2: 1.4, lean: -1.5, cr: 37 };
    case 'win': return { ...guard, ua1: 2.95, fa1: 3.05, ua2: .4, fa2: 1.6, th1: .2, th2: -.2, sh1: 0, sh2: 0, lean: 0, cr: 0 };
    default: return guard;
  }
}
function drawFighter(g, f, x, dir, move, t) {
  const P = fighterPose(move, t), ground = 150;
  const hipY = ground - 45 + P.cr;
  const seg = (x0, y0, a, len, w, col) => { const x1 = x0 + Math.sin(a) * len * dir, y1 = y0 + Math.cos(a) * len; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); return [x1, y1]; };
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, ground + 2, 24, 4, 0, 0, TAU); g.fill();
  // back limbs first
  const kb = seg(x - 3 * dir, hipY, P.th2, 23, 9, f.pants); const fb = seg(kb[0], kb[1], P.sh2, 22, 8, f.pants);
  g.fillStyle = '#15191d'; g.fillRect(fb[0] - 5, fb[1] - 2, 10, 4);
  const sx = x + Math.sin(P.lean) * 34 * dir, sy = hipY - Math.cos(P.lean) * 34;
  const eb = seg(sx - 2 * dir, sy + 3, P.ua2, 17, 7, f.top); const hb = seg(eb[0], eb[1], P.fa2, 15, 6, f.skin);
  g.fillStyle = f.skin; g.beginPath(); g.arc(hb[0], hb[1], 4, 0, TAU); g.fill();
  // torso + belt
  g.strokeStyle = f.top; g.lineWidth = 17; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, hipY - 3); g.lineTo(sx, sy); g.stroke();
  g.strokeStyle = f.belt; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 8, hipY - 1); g.lineTo(x + 8, hipY - 1); g.stroke();
  // front leg
  const kf = seg(x + 3 * dir, hipY, P.th1, 23, 9, f.pants); const ff = seg(kf[0], kf[1], P.sh1, 22, 8, f.pants);
  g.fillStyle = '#15191d'; g.fillRect(ff[0] - 5, ff[1] - 2, 10, 4);
  // head
  const hx = sx + Math.sin(P.lean) * 11 * dir, hy = sy - Math.cos(P.lean) * 11;
  g.fillStyle = f.skin; g.beginPath(); g.arc(hx, hy, 8.5, 0, TAU); g.fill();
  g.fillStyle = f.hair; g.beginPath(); g.arc(hx - 1.5 * dir, hy - 2.5, 8.6, Math.PI * 1.05, Math.PI * 2.05); g.fill();
  g.fillStyle = '#15191d'; g.fillRect(hx + 3.5 * dir - 1, hy - 1.5, 2, 2);
  // front arm on top
  const ef = seg(sx + 3 * dir, sy + 3, P.ua1, 17, 7, f.top); const fist = seg(ef[0], ef[1], P.fa1, 15, 6, f.skin);
  g.fillStyle = f.skin; g.beginPath(); g.arc(fist[0], fist[1], 4.5, 0, TAU); g.fill();
  return fist;
}
function drawGame(dt) {
  gameT += dt; gameAcc += dt; if (gameAcc < .045) return;
  const step = gameAcc; gameAcc = 0;
  const F = fightState, g = gameCanvas.getContext('2d');
  // --- simple choreography ---
  F.mt[0] += step; F.mt[1] += step; F.clock = Math.max(0, F.clock - step * .8);
  if (F.ko > 0) {
    F.ko -= step;
    if (F.ko <= 0) { F.hp = [1, 1]; F.x = [110, 210]; F.move = ['idle', 'idle']; F.clock = 60; if (Math.max(...F.wins) >= 2) { F.wins = [0, 0]; F.round = 1; } else F.round++; }
  } else {
    F.nextAct -= step;
    for (let i = 0; i < 2; i++) if (F.move[i] !== 'idle' && F.mt[i] > .45) F.move[i] = 'idle';
    const gap = F.x[1] - F.x[0];
    if (gap > 70) { F.x[0] += step * 30; F.x[1] -= step * 30; }
    if (F.nextAct <= 0 && gap <= 74) {
      const a = Math.random() < .5 ? 0 : 1, d = 1 - a, atk = vpick(['punch', 'punch', 'kick', 'uppercut']);
      F.move[a] = atk; F.mt[a] = 0;
      const blocked = Math.random() < .3;
      F.move[d] = blocked ? 'block' : 'hit'; F.mt[d] = -.12;
      if (!blocked) {
        F.hp[d] = Math.max(0, F.hp[d] - (atk === 'uppercut' ? .2 : atk === 'kick' ? .14 : .08));
        F.x[d] += (d ? 1 : -1) * (atk === 'uppercut' ? 22 : 12); F.spark = { x: (F.x[0] + F.x[1]) / 2, y: atk === 'kick' ? 112 : 88, t: 0, big: atk === 'uppercut' }; F.shake = .15;
      }
      if (F.hp[d] <= 0 || F.clock <= 0) { const w = F.hp[0] >= F.hp[1] ? 0 : 1; F.wins[w]++; F.move[w] = 'win'; F.move[1 - w] = 'ko'; F.mt = [0, 0]; F.ko = 3.2; }
      F.nextAct = vrnd(.45, 1.1);
    }
    F.x[0] = Math.max(40, Math.min(F.x[0], 280)); F.x[1] = Math.max(F.x[0] + 46, Math.min(F.x[1], 290));
    if (gap < 60 && F.move[0] === 'idle' && F.move[1] === 'idle') { F.x[0] -= step * 14; F.x[1] += step * 14; }
  }
  // --- stage ---
  g.save();
  if (F.shake > 0) { F.shake -= step; g.translate((Math.random() - .5) * 4, (Math.random() - .5) * 3); }
  const sky = g.createLinearGradient(0, 0, 0, 120); sky.addColorStop(0, '#2b1f4a'); sky.addColorStop(.6, '#c4547a'); sky.addColorStop(1, '#f2a65a');
  g.fillStyle = sky; g.fillRect(-4, -4, 328, 130);
  g.fillStyle = 'rgba(255,230,180,.85)'; g.beginPath(); g.arc(250, 70, 16, 0, TAU); g.fill();
  g.fillStyle = '#3b2a4f'; for (let i = 0; i < 12; i++) { const h = 30 + ((i * 37) % 45); g.fillRect(i * 28 - 4, 120 - h, 22, h); }
  g.fillStyle = 'rgba(255,214,120,.6)'; for (let i = 0; i < 40; i++) g.fillRect((i * 53) % 320, 80 + ((i * 29) % 36), 2, 2);
  g.fillStyle = '#5a3d2e'; g.fillRect(-4, 120, 328, 64);
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; for (let i = -8; i < 16; i++) { g.beginPath(); g.moveTo(160 + i * 12, 120); g.lineTo(160 + i * 40, 184); g.stroke(); }
  // fighters
  drawFighter(g, FIGHTERS[0], F.x[0], 1, F.move[0], Math.max(0, F.mt[0]));
  drawFighter(g, FIGHTERS[1], F.x[1], -1, F.move[1], Math.max(0, F.mt[1]));
  if (F.spark) {
    F.spark.t += step; const k = F.spark.t / .25;
    if (k < 1) { g.strokeStyle = `rgba(255,240,170,${1 - k})`; g.lineWidth = 2; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, r0 = 3 + k * 6, r1 = (F.spark.big ? 16 : 10) + k * 8; g.beginPath(); g.moveTo(F.spark.x + Math.cos(a) * r0, F.spark.y + Math.sin(a) * r0); g.lineTo(F.spark.x + Math.cos(a) * r1, F.spark.y + Math.sin(a) * r1); g.stroke(); } }
    else F.spark = null;
  }
  g.restore();
  // --- HUD ---
  const bar = (x, w, v, right) => { g.fillStyle = '#1b1f24'; g.fillRect(x - 1, 9, w + 2, 10); g.fillStyle = '#7a1f1f'; g.fillRect(x, 10, w, 8); g.fillStyle = v > .3 ? '#f2d14a' : '#f07a3a'; const vw = w * v; g.fillRect(right ? x + w - vw : x, 10, vw, 8); };
  bar(12, 118, F.hp[0], false); bar(190, 118, F.hp[1], true);
  g.fillStyle = '#fff'; g.font = 'bold 9px monospace'; g.textBaseline = 'top';
  g.fillText(FIGHTERS[0].name, 12, 21); g.textAlign = 'right'; g.fillText(FIGHTERS[1].name, 308, 21); g.textAlign = 'left';
  for (let i = 0; i < 2; i++) for (let w = 0; w < 2; w++) { g.fillStyle = F.wins[i] > w ? '#f2d14a' : 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(i ? 300 - w * 9 : 20 + w * 9, 36, 3, 0, TAU); g.fill(); }
  g.fillStyle = '#1b1f24'; g.fillRect(145, 6, 30, 20); g.fillStyle = '#fff'; g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.fillText(String(Math.ceil(F.clock)).padStart(2, '0'), 160, 9);
  if (F.ko > 0) { g.font = 'bold 30px sans-serif'; g.fillStyle = '#f2d14a'; g.strokeStyle = '#7a1f1f'; g.lineWidth = 4; g.strokeText('K.O.', 160, 60); g.fillText('K.O.', 160, 60); }
  else if (F.clock > 58.4) { g.font = 'bold 18px sans-serif'; g.fillStyle = '#fff'; g.strokeStyle = '#1b1f24'; g.lineWidth = 4; const t = `ROUND ${F.round}`; g.strokeText(t, 160, 62); g.fillText(t, 160, 62); }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  gameTex.needsUpdate = true;
}

let loungeTV, loungeTVDefault, LOUNGE_TV_POS, gameCanvas, gameTex, gameMat;

function buildGame() {
  loungeTV = tv(317.9, 298.0, 329.0, 344.1, E, 'dash');
  loungeTVDefault = loungeTV.material;
  LOUNGE_TV_POS = W(323.5, 321.05);
  interactables.of('lounge').slice(5).forEach(sp => { sp.game = true; sp.place = 'the TV lounge'; });
  // Game console standing beside the TV
  {
    const f = frame(331, 350, E); addObs(328, 346, 335, 354);
    box(f, .26, .02, .14, M.chairBase, 0, .01, 0);
    box(f, .1, .4, .25, M.white, -.03, .22, 0);
    box(f, .1, .4, .25, M.white, .03, .22, 0);
    box(f, .045, .39, .23, M.chairBase, 0, .22, 0);
    const led = new THREE.Mesh(boxGeo(.004, .004, .2), new THREE.MeshBasicMaterial({ color: 0x5ab5ff })); led.position.set(0, .43, 0); f.add(led);
  }
  // Animated 1v1 fighting game for the lounge TV (original fighters, not any real game)
  gameCanvas = document.createElement('canvas');
  gameCanvas.width = 320;
  gameCanvas.height = 180;
  gameTex = new THREE.CanvasTexture(gameCanvas);
  gameTex.colorSpace = THREE.SRGBColorSpace;
  gameMat = new THREE.MeshBasicMaterial({ map: gameTex, toneMapped: false });
}

export { LOUNGE_TV_POS, drawGame, gameCanvas, gameMat, loungeTV, loungeTVDefault, buildGame };
