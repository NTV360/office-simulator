import { keys } from '../camera/input.js';
import { setView } from '../camera/controller.js';
import { FULL_H, LOW_H, JUMP, RUN_SPEED, WALK_SPEED, adjustCrouch, angDiff, canMove, carryPace, people, postureSpeedFactor, stepPlayer } from '@office/shared';
import { renderer } from '../render/renderer.js';
import { $ } from '../ui/dom.js';
import { wall } from '../world/helpers.js';
import { player } from './player.js';
import { updatePrompts } from './prompts.js';
import { standUp, toggleSit } from './seating.js';

// Shared by first and third person: the user is steering the player's character.
// Holds the look angles, the touch stick, and turns input into movement.
const el = renderer.domElement;
const ctl = {
  active: false, mode: null, yaw: 0, pitch: 0, pitchMin: -1.2, pitchMax: 1.2, savedWall: LOW_H, coarse: false,
  stickId: null, stickO: null, stick: { x: 0, y: 0 }, lookId: null, lx: 0, ly: 0,
  keyHook: null, wheelHook: null, pickupHook: null, // a mode can claim extra keys / the mouse wheel; objects may claim E
  attackPress: null,
  attackKind: null,
  attackPointerId: null,
  attackSource: null,
  characterTarget: null,
  faceTo: null, // turning to face something before taking hold of it (net/objects.js): the way to turn, or null
  crouchWheel: 0,
};

// Start steering. `mode` is 'fp' or 'tp'; the HUD bar texts differ per mode.
function beginControl(mode, p, hud) {
  Object.assign(ctl, { active: true, mode, yaw: p.face, pitch: -.08, savedWall: wall.goal });
  player.moving = false; player.controlling = true;
  wall.goal = FULL_H;
  document.body.classList.add(mode);
  $('fpBar').hidden = false; $('stick').hidden = !ctl.coarse; $('fpPrompt').hidden = false; $('fpAttacks').hidden = !player.online?.attack;
  $('fpMode').textContent = hud.title; $('fpKeys').textContent = hud.keys; $('fpWho').textContent = 'Walking as you';
}
const PLAY_VIEWS = new Set(['fp', 'third']);
// Stop steering. Stand up unless we are just swapping between first and third person.
function endControl(nextId) {
  lastDriveAt = null;
  const p = player.person; if (player.sitting && p && !PLAY_VIEWS.has(nextId) && !player.online) standUp(p); // (online you stay in your seat until you stand up)
  releaseSticks();
  player.controlling = false;
  document.body.classList.remove(ctl.mode);
  ctl.pickupHook?.(false);
  Object.assign(ctl, { active: false, mode: null, stickId: null, lookId: null, keyHook: null, wheelHook: null });
  wall.goal = ctl.savedWall; ctl.stick.x = ctl.stick.y = 0;
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  $('fpBar').hidden = true; $('stick').hidden = true; $('fpPrompt').hidden = true; $('fpAttacks').hidden = true;
}

// Let go of the touch stick and the look finger (the window lost focus, a cancelled touch, the chat box opened): online that would be a
// stream of walking orders.
function releaseSticks() {
  ctl.stickId = null; ctl.lookId = null; ctl.stick.x = ctl.stick.y = 0;
  if (ctl.attackKind && player.online?.attack) { player.online.attack('release', ctl.attackKind, undefined, ctl.pitch); ctl.attackKind = null; ctl.attackPointerId = null; ctl.attackSource = null; }
}

function beginAttack(kind, source = 'keyboard') {
  if (!ctl.active || ctl.attackKind || !player.online?.attack) return false;
  if (!player.online.attack('begin', kind, undefined, ctl.pitch)) return false;
  ctl.attackKind = kind; ctl.attackPointerId = null; ctl.attackSource = source;
  return true;
}

function endAttack(source) {
  if (!ctl.attackKind || (source && ctl.attackSource !== source) || !player.online?.attack) return false;
  player.online.attack('release', ctl.attackKind, undefined, ctl.pitch);
  ctl.attackKind = null; ctl.attackPointerId = null; ctl.attackSource = null;
  return true;
}

// While something is held, the mouse may be wanted for it (net/objects.js): turning it (R and the mouse), throwing it (the right button). These
// hooks say so by returning true. (Not cleared on leaving first person: they ask whether something is held each time.)
function look(dx, dy) {
  if (ctl.holdLook && ctl.holdLook(dx, dy)) return;
  ctl.yaw -= dx * .0035; ctl.pitch = Math.max(ctl.pitchMin, Math.min(ctl.pitchMax, ctl.pitch - dy * .0035));
}
function pointerDown(e) {
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  if (e.button === 2 && ctl.holdPress && ctl.holdPress(true)) { e.preventDefault(); return; }
  if (e.pointerType === 'mouse' && e.button === 0 && player.online?.attack) {
    const kind = e.altKey ? 'kick' : 'punch';
    if (beginAttack(kind, `pointer:${e.pointerId}`)) { ctl.attackPointerId = e.pointerId; e.preventDefault(); return; }
  }
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
  if (e.button === 2 && ctl.holdPress) ctl.holdPress(false);
  if (e.button === 0 && e.pointerId === ctl.attackPointerId && player.online?.attack && ctl.attackKind) {
    endAttack(`pointer:${e.pointerId}`);
  }
  if (e.pointerId === ctl.stickId) { ctl.stickId = null; ctl.stick.x = ctl.stick.y = 0; $('knob').style.transform = ''; const st = $('stick'); st.style.left = ''; st.style.bottom = ''; }
  if (e.pointerId === ctl.lookId) ctl.lookId = null;
}
function pointerCancel(e) {
  if (e.pointerId === ctl.attackPointerId) releaseSticks();
  else {
    if (e.pointerId === ctl.stickId) { ctl.stickId = null; ctl.stick.x = ctl.stick.y = 0; $('knob').style.transform = ''; const st = $('stick'); st.style.left = ''; st.style.bottom = ''; }
    if (e.pointerId === ctl.lookId) ctl.lookId = null;
  }
  ctl.pickupHook?.(false);
}
function isEditableTarget(target) {
  // Gameplay keys must still work after a HUD button has focus. Only text-entry
  // controls own the keyboard; prompt buttons are not keyboard editors.
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

// Read keys + stick, turn the camera heading with arrow keys, and move the player. Returns what happened.
function driveLocomotion(dt, p) {
  if (player.online) return driveOnline(dt, p);
  let f = 0, r = 0, turn = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1; if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a')) r -= 1; if (keys.has('d')) r += 1;
  if (keys.has('arrowleft')) turn += 1; if (keys.has('arrowright')) turn -= 1;
  f -= ctl.stick.y; r += ctl.stick.x;
  ctl.yaw += turn * 2.2 * dt;
  p._lookYaw = ctl.yaw;
  p._lookPitch = ctl.pitch;
  const crouch = keys.has('control') || keys.has('ctrl');
  const prone = keys.has('z');
  const jump = keys.has(' ') || keys.has('space');
  const mechanics = p.mechanics;
  if (crouch) {
    mechanics.posture = 'crouching';
    mechanics.crouchLevel = adjustCrouch(mechanics.crouchLevel, ctl.crouchWheel);
  } else if (mechanics.posture === 'crouching') {
    mechanics.posture = 'standing'; mechanics.crouchLevel = 0;
  }
  if (prone && !mechanics.proneHeld) mechanics.posture = mechanics.posture === 'prone' ? 'standing' : 'prone';
  mechanics.proneHeld = prone;
  if (jump && !mechanics.jumpHeld && mechanics.grounded
    && (mechanics.jumpUntil === 0 || (p._predictionTick ?? 0) >= mechanics.jumpUntil + Math.ceil(JUMP.cooldown / Math.max(dt, .001)))
    && canMove(mechanics) && mechanics.posture !== 'prone') {
    mechanics.locomotion = 'jump'; mechanics.grounded = false; mechanics.verticalVelocity = JUMP.velocity;
    mechanics.jumpUntil = (p._predictionTick ?? 0) + Math.ceil(JUMP.duration / Math.max(dt, .001));
  }
  mechanics.jumpHeld = jump;
  p._predictionTick = (p._predictionTick ?? 0) + 1;
  if (mechanics.locomotion === 'jump') mechanics.verticalVelocity -= 9.8 * dt;
  if (mechanics.locomotion === 'jump' && p._predictionTick >= mechanics.jumpUntil) {
    mechanics.locomotion = 'grid'; mechanics.grounded = true; mechanics.verticalVelocity = 0;
  }
  const len = Math.hypot(f, r); let moved = 0, dx = 0, dz = 0;
  if (len > .08 && player.sitting) standUp(p);
  if (len > .08 && canMove(mechanics)) {
    const carried = carryPace(p.id);
    const sp = (keys.has('shift') && carried.run ? RUN_SPEED : WALK_SPEED) * carried.factor
      * postureSpeedFactor(p.mechanics.posture, p.mechanics.crouchLevel) * Math.min(1, len) * dt;
    const fx = Math.sin(ctl.yaw), fz = Math.cos(ctl.yaw), rx = -Math.cos(ctl.yaw), rz = Math.sin(ctl.yaw);
    dx = (fx * f + rx * r) / len * sp; dz = (fz * f + rz * r) / len * sp;
    moved = stepPlayer(p, dx, dz, people);
  }
  player.moving = moved > 1e-4; p.walkPhase += moved * 4.6; p.animT += dt;
  return { moved, dx, dz };
}

// Online: the same keys and stick. What is wanted (which way, how fast, which way to face) goes to the server, which does the walking
// by the same rules. So that the keys answer at once, your person is also moved here, right now, with the same shared collision and
// speed (prediction); the server's `ack` messages are compared with that and pull it back if the two ever disagree (net/online.js).
// Whether you are seated is read from what the server says (it decides), and it stands you up when you walk.
let lastDriveAt = null; // when driveOnline last ran (null while you are not steering)
function driveOnline(dt, p) {
  let f = 0, r = 0, turn = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1; if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a')) r -= 1; if (keys.has('d')) r += 1;
  if (keys.has('arrowleft')) turn += 1; if (keys.has('arrowright')) turn -= 1;
  f -= ctl.stick.y; r += ctl.stick.x;
  ctl.yaw += turn * 2.2 * dt;
  const len = Math.hypot(f, r);
  let mx = 0, mz = 0;
  if (len > .08) {
    const fx = Math.sin(ctl.yaw), fz = Math.cos(ctl.yaw), rx = -Math.cos(ctl.yaw), rz = Math.sin(ctl.yaw), k = Math.min(1, len) / len;
    mx = (fx * f + rx * r) * k; mz = (fz * f + rz * r) * k;
  }
  // first person faces where you look; third person faces where you walk. Turning to take hold of something (ctl.faceTo, net/objects.js),
  // you turn to it first: the view in first person, the body in third (thirdPerson.js)
  if (ctl.faceTo !== null && ctl.mode === 'fp') ctl.yaw += angDiff(ctl.yaw, ctl.faceTo) * (1 - Math.exp(-dt * 14));
  p._lookYaw = ctl.yaw;
  p._lookPitch = ctl.pitch;
  const heading = ctl.mode === 'fp' ? ctl.yaw : (ctl.faceTo !== null ? p.face : len > .08 ? Math.atan2(mx, mz) : p.face);
  const run = keys.has('shift');
  const crouch = keys.has('control') || keys.has('ctrl');
  const prone = keys.has('z');
  const jump = keys.has(' ') || keys.has('space');
  const struggle = keys.has('x');
  const seat = p.task && p.task.kind === 'playerSit' ? p.task.spot : null;
  if (seat && !player.sitting) { ctl.yaw = seat.face; ctl.pitch = -.12; } // just sat down: look the way the seat faces
  player.sitting = seat;
  // Predict the same state edges and speed factor as shared stepDriven. The server remains authoritative;
  // this only makes the local copy respond immediately while the ack reconciler corrects divergence.
  const nowMs = performance.now(), elapsed = lastDriveAt === null ? dt : Math.min(.25, Math.max(dt, (nowMs - lastDriveAt) / 1000));
  lastDriveAt = nowMs;
  const mechanics = p.mechanics;
  // (as the server: nobody chooses a posture while ragdolled or recovering)
  const downed = mechanics.posture === 'ragdoll' || mechanics.posture === 'recovering' || mechanics.locomotion === 'ragdoll';
  if (!downed) {
    if (crouch) {
      mechanics.posture = 'crouching';
      mechanics.crouchLevel = adjustCrouch(mechanics.crouchLevel, ctl.crouchWheel);
    } else if (mechanics.posture === 'crouching') {
      // Wheel changes depth only while crouch is held; releasing the key always stands.
      mechanics.posture = 'standing'; mechanics.crouchLevel = 0;
    }
    if (prone && !mechanics.proneHeld) mechanics.posture = mechanics.posture === 'prone' ? 'standing' : 'prone';
  }
  mechanics.proneHeld = prone;
  if (jump && !mechanics.jumpHeld && mechanics.grounded
    && (mechanics.jumpUntil === 0 || (p._predictionTick ?? 0) >= mechanics.jumpUntil + Math.ceil(JUMP.cooldown / Math.max(dt, .001)))
    && canMove(mechanics) && mechanics.posture !== 'prone') {
    mechanics.locomotion = 'jump'; mechanics.grounded = false; mechanics.verticalVelocity = JUMP.velocity;
    mechanics.jumpUntil = (p._predictionTick ?? 0) + Math.ceil(JUMP.duration / Math.max(dt, .001));
  }
  mechanics.jumpHeld = jump;
  p._predictionTick = (p._predictionTick ?? 0) + 1;
  if (mechanics.locomotion === 'jump') mechanics.verticalVelocity -= 9.8 * elapsed;
  if (mechanics.locomotion === 'jump' && p._predictionTick >= mechanics.jumpUntil) {
    mechanics.locomotion = 'grid'; mechanics.grounded = true; mechanics.verticalVelocity = 0;
  }
  let moved = 0;
  const stick = Math.hypot(mx, mz);
  // The server walks you in real time; use elapsed wall time (up to a quarter second) so a slow frame does not lag behind it.
  if (!seat && stick > .08 && player.online.predicting && canMove(mechanics)) {
    const pace = carryPace(p.id);
    const speed = (run && pace.run ? RUN_SPEED : WALK_SPEED) * pace.factor * postureSpeedFactor(mechanics.posture, mechanics.crouchLevel) * Math.min(1, stick) * elapsed;
    const steps = Math.max(1, Math.ceil(speed / .25));
    for (let i = 0; i < steps; i++) moved += stepPlayer(p, mx / stick * speed / steps, mz / stick * speed / steps, people);
    if (moved > 0) player.online.movedNow();
  }
  player.moving = moved > 1e-4 || (seat === null && performance.now() - player.online.lastMovedAt < 150);
  p.walkPhase += moved * 4.6;
  const wheel = ctl.crouchWheel;
  const sent = player.online.input(mx, mz, heading, run, { crouch, prone, jump, struggle, crouchWheel: wheel }); // after moving: the position recorded with the input is where the prediction is
  if (sent && wheel) ctl.crouchWheel = 0; // wheel input is an edge; do not apply the same notch on every repeat
  return { moved, dx: mx, dz: mz };
}

// Refresh the sit/stand button and the "who am I looking at" label a few times a second.
let promptAcc = 0;
let promptFailed = false;
// (the prompts are only text and buttons: if building them ever fails, say so once and carry on, rather than stopping the whole frame loop)
function tickPrompts(dt) {
  promptAcc += dt;
  if (promptAcc <= .2) return;
  promptAcc = 0;
  try { updatePrompts(); } catch (error) { if (!promptFailed) { promptFailed = true; console.error('updating the prompts failed:', error); } }
}

function initControl() {
  ctl.coarse = matchMedia('(pointer: coarse)').matches;
  el.addEventListener('wheel', e => {
    if (!ctl.active || !keys.has('control') && !keys.has('ctrl')) return;
    ctl.crouchWheel += e.deltaY > 0 ? -1 : 1;
    e.preventDefault();
  }, { passive: false });
  $('fpAct').onclick = toggleSit;
  const attacks = $('fpAttacks');
  const attackButton = (button, kind) => {
    button.addEventListener('pointerdown', e => { e.preventDefault(); if (beginAttack(kind, `button:${kind}`)) { try { button.setPointerCapture(e.pointerId); } catch (_) {} } });
    const stop = e => { e.preventDefault(); endAttack(`button:${kind}`); };
    button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
  };
  attackButton($('fpPunch'), 'punch'); attackButton($('fpKick'), 'kick');
  // Buttons are useful on touch; keyboard attacks are intents only: the server validates limbs, reach, timing, and damage.
  addEventListener('keydown', e => {
    if (!ctl.active || isEditableTarget(e.target) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'k') {
      if (beginAttack(k === 'k' ? 'kick' : 'punch', `key:${k}`)) e.preventDefault();
    }
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'k') endAttack(`key:${k}`);
  });
  // Character interactions are intents only: the server validates reach, holds, throws, and damage.
  addEventListener('keydown', e => {
    if (!ctl.active || isEditableTarget(e.target) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase(), p = player.person, target = ctl.characterTarget;
    if (!p || !player.online?.character) return;
    if (k === 'q' && p.mechanics?.posture !== 'seated' && p.task?.kind !== 'playerSit' && target && target !== p && !p.mechanics?.holdTarget) player.online.character('grab', target.id);
    else if (k === 'f' && p.mechanics?.holdTarget) player.online.character('release');
    else if (k === 'h' && p.mechanics?.holdTarget) player.online.character('throw');
  });
  // losing the window (or a cancelled touch) must not leave the stick held: online that is a stream of walking orders
  addEventListener('blur', () => { releaseSticks(); ctl.pickupHook?.(false); });
  el.addEventListener('pointercancel', pointerCancel);
  $('fpExit').onclick = exitPlay;
  addEventListener('keydown', e => {
    if (!ctl.active || isEditableTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && !e.repeat) {
      const handled = ctl.pickupHook?.(true) || ctl.keyHook?.(k, true);
      if (!handled) toggleSit();
    } else if (ctl.keyHook && !e.repeat) ctl.keyHook(k, true);
    if (k === 'escape' && !document.pointerLockElement) exitPlay();
    if (k === 'v' && !e.repeat) setView(ctl.mode === 'fp' ? 'third' : 'fp');
  });
  addEventListener('keyup', e => {
    if (e.key.toLowerCase() === 'e') ctl.pickupHook?.(false);
  });
}
// Stop steering the player; the camera stays free-orbiting around them.
function exitPlay() { if (ctl.active) setView('free'); }

export { beginControl, ctl, driveLocomotion, el, endControl, exitPlay, initControl, pointerDown, pointerMove, pointerUp, releaseSticks, tickPrompts };
