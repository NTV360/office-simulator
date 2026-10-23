import * as THREE from 'three';
import { interactables, S, W, wx, wz } from '@office/shared';
import { M } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, mkSpot } from './basics.js';
import { box, cyl, staticRoot } from '../helpers.js';

// You on the putting strip (ui/interact.js): putt the ball toward a point; it rolls, slows, bounces off the rails
// and drops in when it passes over the hole slowly enough. While you play (`active`) the ball is yours.
const PUTT = { active: false, vel: new THREE.Vector3(), strokes: 0, result: '', resetIn: 0 };
const STRIP = [655, 970, 679, 1066]; // plan pixels: the strip inside its rails
const ROLL = 1.1, CUP = .06, DROP = 1.6; // slowing (m/s²); the hole's catch radius (m), and the fastest a ball drops in (m/s)

// Whether you can play: nobody else is putting.
function canPutt() { return PUTT.active || !GOLF_BALLS[0].spot.occupant; }
function golfBall() { return GOLF_BALLS[0].ball; }
// Putt toward `target` (a point on the green): hard enough to roll about that far.
function putt(target) {
  const b = golfBall(), dx = target.x - b.position.x, dz = target.z - b.position.z, d = Math.hypot(dx, dz); if (d < .05) return;
  const speed = Math.min(4.5, Math.sqrt(2 * ROLL * d) * (1 + (Math.random() - .5) * .12)); // a little off, like a real putt
  const a = Math.atan2(dx, dz) + (Math.random() - .5) * .05;
  PUTT.vel.set(Math.sin(a) * speed, 0, Math.cos(a) * speed);
  Object.assign(PUTT, { active: true, strokes: PUTT.strokes + 1, result: '' });
}
// Give the ball back (you walked off): it goes back on the tee.
function resetPutt() { const g = GOLF_BALLS[0]; Object.assign(PUTT, { active: false, strokes: 0, result: '', resetIn: 0 }); PUTT.vel.set(0, 0, 0); g.ball.position.set(g.start.x, .05, g.start.z); g.ball.visible = true; }
function rollBall(dt) {
  const b = golfBall(), v = PUTT.vel;
  if (PUTT.resetIn > 0) { if ((PUTT.resetIn -= dt) <= 0) { const result = PUTT.result; resetPutt(); PUTT.active = true; PUTT.result = result; } return; }
  const speed = Math.hypot(v.x, v.z); if (speed < .01) { v.set(0, 0, 0); return; }
  b.position.x += v.x * dt; b.position.z += v.z * dt;
  const slow = Math.max(0, speed - ROLL * dt) / speed; v.x *= slow; v.z *= slow;
  // the rails
  const [x1, y1, x2, y2] = STRIP, r = .03, minX = wx(x1) + r, maxX = wx(x2) - r, minZ = wz(y1) + r, maxZ = wz(y2) - r;
  if (b.position.x < minX || b.position.x > maxX) { b.position.x = Math.max(minX, Math.min(maxX, b.position.x)); v.x *= -.6; }
  if (b.position.z < minZ || b.position.z > maxZ) { b.position.z = Math.max(minZ, Math.min(maxZ, b.position.z)); v.z *= -.6; }
  // the hole
  if (Math.hypot(b.position.x - GOLF_HOLE.x, b.position.z - GOLF_HOLE.z) < CUP && speed < DROP) {
    b.position.set(GOLF_HOLE.x, .01, GOLF_HOLE.z); v.set(0, 0, 0);
    PUTT.result = PUTT.strokes === 1 ? 'Hole in one!' : `In, ${PUTT.strokes} strokes`; PUTT.resetIn = 2.5;
  }
}

function updateGolf(dt) {
  if (PUTT.active) { rollBall(dt); return; }
  for (const g of GOLF_BALLS) {
    const p = g.spot.occupant, b = g.ball;
    if (!p || p.state !== 'doing') { b.position.set(g.start.x, .05, g.start.z); b.visible = true; continue; }
    const ph = (p.animT + g.spot.pos.z) % 8;
    if (ph < 1.4) { b.position.set(g.start.x, .05, g.start.z); b.visible = true; }
    else if (ph < 4) { const k = 1 - Math.pow(1 - (ph - 1.4) / 2.6, 2.2); b.position.set(g.start.x + (GOLF_HOLE.x - g.start.x) * k, .05, g.start.z + (GOLF_HOLE.z - g.start.z) * k); b.visible = true; }
    else b.visible = false;
  }
}

let GOLF_HOLE, GOLF_BALLS;

function buildGolf() {
  
  // Mini golf: one simple straight putting strip along the east wall
  GOLF_HOLE = W(667, 982);
  GOLF_BALLS = [];
  {
    const x1 = 655, x2 = 679, y1 = 970, y2 = 1066;
    const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
    box(staticRoot, w, .025, d, M.turf, cx, .0125, cz, false);
    box(staticRoot, w, .07, .05, M.diningWood2, cx, .035, wz(y1));
    box(staticRoot, .05, .07, d, M.diningWood2, wx(x1), .035, cz);
    box(staticRoot, .05, .07, d, M.diningWood2, wx(x2), .035, cz);
    cyl(staticRoot, .055, .055, .006, M.chairBase, GOLF_HOLE.x, .029, GOLF_HOLE.z, 18, false);
    cyl(staticRoot, .007, .007, 1.0, M.white, GOLF_HOLE.x, .52, GOLF_HOLE.z, 6);
    const flag = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -.18, 0), new THREE.Vector3(.26, -.09, 0)]), M.flag);
    flag.geometry.computeVertexNormals(); flag.position.set(GOLF_HOLE.x, 1.02, GOLF_HOLE.z); flag.userData.dynamic = true; scene.add(flag);
    box(staticRoot, .3, .005, .3, M.turfDark, wx(667), .028, wz(1054), false);
    mkSpot('golf', 659, 1054, E, { place: 'the putting strip' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.022, 12, 10), M.white); ball.castShadow = true; scene.add(ball);
    const start = W(667, 1054); ball.position.set(start.x, .05, start.z);
    GOLF_BALLS.push({ ball, start, spot: interactables.of('golf')[0] });
  }
}

export { GOLF_HOLE, PUTT, buildGolf, canPutt, golfBall, putt, resetPutt, updateGolf };
