import { keys } from '../camera/input.js';
import { setView } from '../camera/controller.js';
import { FULL_H, LOW_H } from '../config/plan.js';
import { renderer } from '../render/renderer.js';
import { $ } from '../ui/dom.js';
import { wall } from '../world/helpers.js';
import { stepPlayer } from './locomotion.js';
import { player } from './player.js';
import { updatePrompts } from './prompts.js';
import { standUp, toggleSit } from './seating.js';

// Shared by first and third person: the user is steering the player's character.
// Holds the look angles, the touch stick, and turns input into movement.
const el = renderer.domElement;
const ctl = {
  active: false, mode: null, yaw: 0, pitch: 0, pitchMin: -1.2, pitchMax: 1.2, savedWall: LOW_H, coarse: false,
  stickId: null, stickO: null, stick: { x: 0, y: 0 }, lookId: null, lx: 0, ly: 0,
  keyHook: null, wheelHook: null, // a mode can claim extra keys / the mouse wheel
};

// Start steering. `mode` is 'fp' or 'tp'; the HUD bar texts differ per mode.
function beginControl(mode, p, hud) {
  Object.assign(ctl, { active: true, mode, yaw: p.face, pitch: -.08, savedWall: wall.goal });
  player.moving = false;
  wall.goal = FULL_H;
  document.body.classList.add(mode);
  $('fpBar').hidden = false; $('stick').hidden = !ctl.coarse; $('fpPrompt').hidden = false;
  $('fpMode').textContent = hud.title; $('fpKeys').textContent = hud.keys; $('fpWho').textContent = 'Walking as you';
}
const PLAY_VIEWS = new Set(['fp', 'third']);
// Stop steering. Stand up unless we are just swapping between first and third person.
function endControl(nextId) {
  const p = player.person; if (player.sitting && p && !PLAY_VIEWS.has(nextId)) standUp(p);
  document.body.classList.remove(ctl.mode);
  Object.assign(ctl, { active: false, mode: null, stickId: null, lookId: null, keyHook: null, wheelHook: null });
  wall.goal = ctl.savedWall; ctl.stick.x = ctl.stick.y = 0;
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  $('fpBar').hidden = true; $('stick').hidden = true; $('fpPrompt').hidden = true;
}

function look(dx, dy) { ctl.yaw -= dx * .0035; ctl.pitch = Math.max(ctl.pitchMin, Math.min(ctl.pitchMax, ctl.pitch - dy * .0035)); }
function pointerDown(e) {
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  if (e.pointerType === 'touch' && e.clientX < innerWidth * .45 && e.clientY > innerHeight * .45 && ctl.stickId === null) {
    ctl.stickId = e.pointerId; ctl.stickO = { x: e.clientX, y: e.clientY };
    const st = $('stick'); st.style.left = (e.clientX - 60) + 'px'; st.style.bottom = (innerHeight - e.clientY - 60) + 'px';
  } else {
    ctl.lookId = e.pointerId; ctl.lx = e.clientX; ctl.ly = e.clientY;
    if (e.pointerType === 'mouse' && !document.pointerLockElement && el.requestPointerLock) { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  }
  e.preventDefault();
}
function pointerMove(e) {
  if (document.pointerLockElement === el && e.pointerType === 'mouse') { look(e.movementX, e.movementY); return; }
  if (e.pointerId === ctl.stickId) {
    let dx = (e.clientX - ctl.stickO.x) / 50, dy = (e.clientY - ctl.stickO.y) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    ctl.stick.x = dx; ctl.stick.y = dy; $('knob').style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  } else if (e.pointerId === ctl.lookId) { look(e.clientX - ctl.lx, e.clientY - ctl.ly); ctl.lx = e.clientX; ctl.ly = e.clientY; }
}
function pointerUp(e) {
  if (e.pointerId === ctl.stickId) { ctl.stickId = null; ctl.stick.x = ctl.stick.y = 0; $('knob').style.transform = ''; const st = $('stick'); st.style.left = ''; st.style.bottom = ''; }
  if (e.pointerId === ctl.lookId) ctl.lookId = null;
}

// Read keys + stick, turn the camera heading with arrow keys, and move the player. Returns what happened.
function driveLocomotion(dt, p) {
  let f = 0, r = 0, turn = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1; if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a')) r -= 1; if (keys.has('d')) r += 1;
  if (keys.has('arrowleft')) turn += 1; if (keys.has('arrowright')) turn -= 1;
  f -= ctl.stick.y; r += ctl.stick.x;
  ctl.yaw += turn * 2.2 * dt;
  const len = Math.hypot(f, r); let moved = 0, dx = 0, dz = 0;
  if (len > .08 && player.sitting) standUp(p);
  if (len > .08) {
    const sp = 1.5 * (keys.has('shift') ? 2 : 1) * Math.min(1, len) * dt;
    const fx = Math.sin(ctl.yaw), fz = Math.cos(ctl.yaw), rx = -Math.cos(ctl.yaw), rz = Math.sin(ctl.yaw);
    dx = (fx * f + rx * r) / len * sp; dz = (fz * f + rz * r) / len * sp;
    moved = stepPlayer(p, dx, dz);
  }
  player.moving = moved > 1e-4; p.walkPhase += moved * 4.6; p.animT += dt;
  return { moved, dx, dz };
}

// Refresh the sit/stand button and the "who am I looking at" label a few times a second.
let promptAcc = 0;
function tickPrompts(dt) { promptAcc += dt; if (promptAcc > .2) { promptAcc = 0; updatePrompts(); } }

function initControl() {
  ctl.coarse = matchMedia('(pointer: coarse)').matches;
  $('fpAct').onclick = toggleSit;
  $('fpExit').onclick = exitPlay;
  addEventListener('keydown', e => {
    if (!ctl.active || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'e' && !e.repeat) toggleSit();
    if (k === 'escape' && !document.pointerLockElement) exitPlay();
    if (k === 'v' && !e.repeat) setView(ctl.mode === 'fp' ? 'third' : 'fp');
    if (ctl.keyHook && !e.repeat) ctl.keyHook(k);
  });
}
// Stop steering the player; the camera stays free-orbiting around them.
function exitPlay() { if (ctl.active) setView('free'); }

export { beginControl, ctl, driveLocomotion, el, endControl, exitPlay, initControl, pointerDown, pointerMove, pointerUp, tickPrompts };
