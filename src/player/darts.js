import * as THREE from 'three';
import { OX, OY, S, wx } from '../config/plan.js';
import { TAU } from '../core/util.js';
import { setView } from '../camera/controller.js';
import { camera } from '../render/renderer.js';
import { $ } from '../ui/dom.js';
import { DART_ZONE, clearDarts, dartBoard, flyDart } from '../world/furniture/darts.js';
import { ctl } from './control.js';
import { player } from './player.js';

/* ================= Playing darts as the player ================= */
// Aim with the crosshair, hold to charge a throw, release to throw. Always played in first person: starting
// from third person switches to first person, and stopping switches back.
const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SWEET = .6;          // the power at which the dart flies where the crosshair points
const HAND_Y = 1.45;       // throwing hand height before the player's scale (third person)
const CHARGE_SECS = 1.1;   // one sweep of the power bar, 0 to 1
const COOLDOWN = .38;      // seconds between throws

const dartsGame = { back: null, on: false, thrown: 0, round: 0, total: 0, msg: '', charging: false, chargeT: 0, power: 0, cool: 0, id: null, task: null };
const dir = new THREE.Vector3(), aim = new THREE.Vector3();

function inDartZone(p) {
  const px = p.pos.x / S + OX, py = p.pos.z / S + OY;
  return px >= DART_ZONE.x0 - 2 && px <= DART_ZONE.x1 && py >= DART_ZONE.y0 && py <= DART_ZONE.y1;
}

// Points for a dart that landed at `pt` on the board; the board is seen from +x, so "right" is -z.
function scoreAt(pt) {
  const c = dartBoard.c, u = -(pt.z - c.z), v = pt.y - c.y, f = Math.hypot(u, v) / (.36 * 250 / 256);
  if (f < .045) return { pts: 50, name: 'Bullseye' };
  if (f < .1) return { pts: 25, name: 'Outer bull' };
  if (f > .78) return { pts: 0, name: 'Miss' };
  const n = DART_ORDER[Math.round((((Math.atan2(u, v) % TAU) + TAU) % TAU) / (TAU / 20)) % 20];
  if (f >= .72) return { pts: n * 2, name: `Double ${n}` };
  if (f >= .44 && f <= .5) return { pts: n * 3, name: `Triple ${n}` };
  return { pts: n, name: String(n) };
}

function startDarts(p) {
  const back = ctl.mode === 'tp' ? 'third' : null;
  if (back) setView('fp');                    // darts is a first-person game; remember where to return to
  const c = dartBoard.c, dx = c.x - p.pos.x, dz = c.z - p.pos.z;
  Object.assign(dartsGame, { back, on: true, thrown: 0, round: 0, total: 0, msg: 'Hold to charge, release to throw', charging: false, chargeT: 0, power: 0, cool: 0, id: null });
  dartsGame.task = { kind: 'playerDarts', anim: 'dartsPlay', throwT: 9, charge: 0 };
  p.task = dartsGame.task;
  ctl.yaw = Math.atan2(dx, dz); ctl.pitch = Math.max(ctl.pitchMin, Math.min(ctl.pitchMax, Math.atan2(c.y - 1.6 * p.spec.scale, Math.hypot(dx, dz))));
  clearDarts(); hookInput();
  $('fpThrow').hidden = false;
}
function stopDarts() {
  if (!dartsGame.on) return;
  const p = player.person;
  const back = dartsGame.back;
  dartsGame.on = false; dartsGame.charging = false; dartsGame.back = null;
  if (p && p.task === dartsGame.task) p.task = null;
  dartsGame.task = null;
  clearDarts(); unhookInput();
  $('fpThrow').hidden = true; $('dartMeter').hidden = true;
  if (back && ctl.active && ctl.mode === 'fp') setView(back);
}

// Input reaches us through hooks on `ctl`, which the first/third person modes clear whenever they swap.
function hookInput() { ctl.pressHook = chargeStart; ctl.releaseHook = chargeRelease; ctl.moveHook = limitToLine; ctl.viewLocked = true; }
function unhookInput() { ctl.pressHook = ctl.releaseHook = ctl.moveHook = null; ctl.viewLocked = false; }
// You may roam the throwing area but not cross the line.
function limitToLine(p) { const lx = wx(DART_ZONE.x0); if (p.pos.x < lx) p.pos.x = lx; }

function chargeStart(id) {
  if (!dartsGame.on || dartsGame.charging || dartsGame.cool > 0) return;
  dartsGame.charging = true; dartsGame.chargeT = 0; dartsGame.power = 0; dartsGame.id = id;
  $('dartMeter').hidden = false;
}
function chargeRelease(id) {
  if (!dartsGame.charging || (id !== undefined && dartsGame.id !== id)) return;
  dartsGame.charging = false; $('dartMeter').hidden = true;
  throwDart(dartsGame.power);
}

// Power 0 is a lob that falls short, power 1 a hard flat throw that scatters more; SWEET lands on the crosshair.
function throwDart(power) {
  const p = player.person; if (!p) return;
  const g = dartsGame, c = dartBoard.c, hx = c.x + .02;
  g.cool = COOLDOWN; g.task.throwT = 0;
  if (g.thrown >= 3) { g.thrown = 0; g.round = 0; clearDarts(); }
  const slot = g.thrown++;
  camera.getWorldDirection(dir);
  if (dir.x > -.05) { g.msg = 'Missed the board'; return; }
  // where the crosshair meets the board plane, lifted by the drop a sweet-spot throw would have
  const t0 = (hx - camera.position.x) / dir.x;
  aim.copy(camera.position).addScaledVector(dir, t0); aim.x = hx;
  const from = new THREE.Vector3();
  if (ctl.mode === 'fp') from.copy(camera.position).addScaledVector(dir, .3).y -= .12;
  else from.set(p.pos.x + Math.sin(p.face) * .35 - Math.cos(p.face) * .2, HAND_Y * p.spec.scale, p.pos.z + Math.cos(p.face) * .35 + Math.sin(p.face) * .2);
  const dist = from.x - hx;
  if (dist < .5) { g.msg = 'Too close to the board'; return; }
  const drop = k => { const tt = 1 / (3.1 + 12 * k); return .5 * 9.8 * tt * tt; };
  aim.y += drop(SWEET);
  dir.copy(aim).sub(from).normalize();
  const v = dist * (3.1 + 12 * power), t = dist / (v * -dir.x);
  const hit = from.clone().addScaledVector(dir, v * t); hit.x = hx; hit.y -= .5 * 9.8 * t * t;
  const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * (.02 + .035 * power) * (dist / 2.4) + Math.sin(dartBoard.now * .004) * .008;
  hit.y += Math.sin(a) * r; hit.z += Math.cos(a) * r;
  const sc = scoreAt(hit), err = drop(SWEET) - drop(power);
  g.round += sc.pts; g.total += sc.pts;
  g.msg = `${sc.name}${sc.pts ? ' · ' + sc.pts : ''}${err > .15 ? ' (too weak)' : err < -.15 ? ' (too strong)' : ''}`;
  flyDart(slot, from, hit, Math.max(150, Math.min(700, t * 1000)));
}

function updatePlayerDarts(dt) {
  const g = dartsGame; if (!g.on) return;
  const p = player.person;
  if (!ctl.active || !p || player.sitting || !inDartZone(p)) { stopDarts(); return; }
  if (!ctl.pressHook) hookInput();           // the view was swapped and the hooks were cleared
  if (!p.task) p.task = g.task;
  g.cool = Math.max(0, g.cool - dt); g.task.throwT += dt;
  if (g.charging) {
    g.chargeT += dt; const ph = (g.chargeT / CHARGE_SECS) % 2; g.power = ph < 1 ? ph : 2 - ph;
    $('dartMeter').firstElementChild.style.width = (g.power * 100).toFixed(0) + '%';
  }
  g.task.charge = g.charging ? g.power : 0;
}

function initDarts() {
  const btn = $('fpThrow');
  btn.addEventListener('pointerdown', e => { chargeStart('btn'); e.preventDefault(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => btn.addEventListener(t, () => chargeRelease('btn')));
}

export { dartsGame, inDartZone, initDarts, startDarts, stopDarts, updatePlayerDarts };
