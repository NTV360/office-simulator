import * as THREE from 'three';
import { TAU, WALL_T, wx, wz } from '@office/shared';
import { M, canvasTex } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, WST, mkSpot } from './basics.js';
import { SERVER_LEDS } from './server.js';
import { addObs, box, boxGeo, cyl, frame, staticRoot } from '../helpers.js';
const DART_SETS = [];
// Your own three darts (ui/interact.js): throw them at the board, then collect them for the next round.
// `board` is the board's face; `flying` the dart on its way: { d, from, to, t }.
const MY_DARTS = { board: null, darts: [], thrown: 0, total: 0, flying: null };
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]; // clockwise from the top
const FACE_R = .3516; // metres: the drawn board's radius (250 of the texture's 256 on a .36 m disc)
const FLIGHT = .28;   // seconds in the air

function makeDart(flightMat) {
  const d = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .13, 6), M.steel); shaft.rotation.z = Math.PI / 2; d.add(shaft);
  for (const r of [0, Math.PI / 2]) { const flight = new THREE.Mesh(boxGeo(.04, .03, .002), flightMat); flight.position.x = .07; flight.rotation.x = r; d.add(flight); } // crossed flights
  d.scale.setScalar(1.6); d.visible = false; scene.add(d); return d;
}
// What a dart at this point on the board scores: { label: 'T20', points: 60 } (a miss scores nothing).
function dartScore(point) {
  const v = MY_DARTS.board.worldToLocal(point.clone()), r = Math.hypot(v.x, v.y) / FACE_R;
  if (r < .045) return { label: 'Bull', points: 50 };
  if (r < .1) return { label: '25', points: 25 };
  if (r > .78) return { label: 'Miss', points: 0 };
  const n = NUMBERS[Math.round(Math.atan2(v.x, v.y) / (TAU / 20) + 20) % 20];
  if (r >= .44 && r <= .5) return { label: `T${n}`, points: n * 3 };
  if (r >= .72) return { label: `D${n}`, points: n * 2 };
  return { label: String(n), points: n };
}
// Throw your next dart from `from` to `to` (on the board's face). Returns its score, or null when all three are
// in the board: then this collects them.
function throwDart(from, to) {
  if (MY_DARTS.thrown === 3) { MY_DARTS.darts.forEach(d => d.visible = false); Object.assign(MY_DARTS, { thrown: 0, total: 0, flying: null }); return null; }
  const d = MY_DARTS.darts[MY_DARTS.thrown++], s = dartScore(to);
  MY_DARTS.total += s.points; MY_DARTS.flying = { d, from: from.clone(), to: to.clone(), t: 0 };
  d.visible = true; d.position.copy(from); d.rotation.set(0, 0, -.08);
  return s;
}

function updateDarts(now, dt) {
  const f = MY_DARTS.flying;
  if (f) { f.t = Math.min(1, f.t + dt / FLIGHT); f.d.position.lerpVectors(f.from, f.to, f.t); f.d.position.y += Math.sin(f.t * Math.PI) * .1; if (f.t === 1) MY_DARTS.flying = null; }
  SERVER_LEDS.forEach((l, i) => { l.visible = Math.sin(now * .004 * (1 + (i % 5) * .37) + i * 1.7) > -.3; });
  for (const set of DART_SETS) {
    const p = set.spot.occupant;
    if (!p || p.state !== 'doing') { set.darts.forEach(d => d.visible = false); continue; }
    const t = p.animT + set.spot.dartOff, n = Math.floor(t / 6), ph = t % 6, k = n % 3;
    const fwd = new THREE.Vector3(Math.sin(p.face), 0, Math.cos(p.face)), right = new THREE.Vector3(-Math.cos(p.face), 0, Math.sin(p.face));
    const hand = new THREE.Vector3().copy(p.pos).add(fwd.multiplyScalar(.35)).add(right.multiplyScalar(.2)); hand.y = 1.75;
    set.darts.forEach((d, j) => {
      const seed = Math.sin((n - (k - j)) * 12.9898 + j * 78.233 + set.spot.dartOff) * 43758.5453, rr = (seed - Math.floor(seed)) * .26, aa = (seed * 7 % 1) * TAU;
      const hit = BOARD_C.clone().add(new THREE.Vector3(.02, Math.sin(aa) * rr, Math.cos(aa) * rr));
      if (j < k) { d.visible = true; d.position.copy(hit); }
      else if (j === k && ph > 1.0) {
        d.visible = true; const q = Math.min(1, (ph - 1.0) / .35);
        d.position.lerpVectors(hand, hit, q); d.position.y += Math.sin(q * Math.PI) * .12;
      } else d.visible = false;
      d.rotation.set(0, 0, -.08);
    });
  }
}

let BOARD_C;

function buildDarts() {
  
  // Dartboard on the column wall beside the counter top
  BOARD_C = new THREE.Vector3(wx(351.8 + WALL_T / 2) + .1, 1.73, wz(925));
  {
    const bx = 351.8 + WALL_T / 2;
    addObs(bx, 905, bx + 4, 945);
    // dark backboard panel (full height so the board shows with low walls too)
    const f = frame(bx + 1.2, 925, E);
    box(f, 1.7, 2.5, .04, M.dartPanel, 0, 1.25, 0);
    box(f, 1.74, .05, .06, M.diningWood2, 0, 2.52, 0);
    cyl(f, .42, .42, .03, M.dartSurround, 0, 1.73, .035, 40).rotation.x = Math.PI / 2;
    const tex = canvasTex(512, 512, (g, w) => {
      const c = w / 2, R = w / 2 - 6;
      g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
      for (let i = 0; i < 20; i++) {
        const a0 = (i - .5) / 20 * TAU - Math.PI / 2, a1 = (i + .5) / 20 * TAU - Math.PI / 2, dark = i % 2 === 0;
        const ring = (r0, r1, col) => { g.fillStyle = col; g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, r0, a1, a0, true); g.closePath(); g.fill(); };
        ring(R * .1, R * .78, dark ? '#1d1d1d' : '#efe2c2');
        ring(R * .44, R * .5, dark ? '#c8302c' : '#2f8f4e');
        ring(R * .72, R * .78, dark ? '#c8302c' : '#2f8f4e');
      }
      g.strokeStyle = '#c9ced3'; g.lineWidth = 1;
      for (let i = 0; i < 20; i++) { const a = (i - .5) / 20 * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * R * .1, c + Math.sin(a) * R * .1); g.lineTo(c + Math.cos(a) * R * .78, c + Math.sin(a) * R * .78); g.stroke(); }
      g.fillStyle = '#2f8f4e'; g.beginPath(); g.arc(c, c, R * .1, 0, TAU); g.fill();
      g.fillStyle = '#c8302c'; g.beginPath(); g.arc(c, c, R * .045, 0, TAU); g.fill();
      g.fillStyle = '#efe2c2'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5].forEach((n, i) => { const a = i / 20 * TAU - Math.PI / 2; g.fillText(String(n), c + Math.cos(a) * R * .89, c + Math.sin(a) * R * .89); });
    });
    const board = new THREE.Mesh(new THREE.CircleGeometry(.36, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
    board.position.set(0, 1.73, .053); f.add(board); board.userData.dynamic = true; MY_DARTS.board = board;
    const mine = new THREE.MeshStandardMaterial({ color: 0x2f8db3, roughness: .6 }); // blue flights: yours
    MY_DARTS.darts = [0, 1, 2].map(() => makeDart(mine));
    // score chalkboard and throw line
    box(f, .36, .5, .02, M.chalk, .66, 1.45, .03);
    box(staticRoot, .05, .004, .9, M.white, wx(410), .003, wz(925), false);
    [[410, 914, 0], [414, 940, 3]].forEach(([px, py, off], i) => {
      const sp = mkSpot('darts', px, py, WST, { place: 'the dartboard' }); sp.dartOff = off;
      const darts = [0, 1, 2].map(() => makeDart(i ? M.golfBallY : M.flag));
      DART_SETS.push({ spot: sp, darts });
    });
  }
}

export { MY_DARTS, buildDarts, throwDart, updateDarts };
