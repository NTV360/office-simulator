import * as THREE from 'three';
import { el, keys } from '../camera/input.js';
import { ray } from '../camera/spots.js';
import { setView } from '../camera/controller.js';
import { spawnPlayer } from '../player/player.js';
import { camGoal, camState } from '../camera/state.js';
import { FULL_H, LOW_H, OX, OY, S } from '../config/plan.js';
import { walkPx } from '../nav/grid.js';
import { camera } from '../render/renderer.js';
import { people } from '../sim/state.js';
import { $ } from '../ui/dom.js';
import { select, statusText } from '../ui/person.js';
import { wall } from '../world/helpers.js';
import { interactables } from '../world/interactables.js';

/* ================= First person ================= */
const fp = { on: false, p: null, yaw: 0, pitch: 0, sitting: null, moving: false, eye: 1.6, savedWall: LOW_H, stickId: null, stickO: null, stick: { x: 0, y: 0 }, lookId: null, lx: 0, ly: 0, acc: 0 };
function enterFP() {
  const p = spawnPlayer();
  select(null);
  p.task = null;
  Object.assign(fp, { on: true, p, yaw: p.face, pitch: -.08, sitting: null, moving: false, eye: 1.6 * p.spec.scale, savedWall: wall.goal });
  wall.goal = FULL_H;
  camera.fov = 68; camera.near = .05; camera.updateProjectionMatrix();
  p.body.root.visible = false; p.body.ring.visible = false;
  document.body.classList.add('fp'); $('fpBar').hidden = false; $('crosshair').hidden = false; $('stick').hidden = !coarse; $('fpPrompt').hidden = false;
  $('fpWho').textContent = 'Walking as you';
}
// Leave first-person mode (called by the camera controller when another mode takes over).
function leaveFP() {
  if (!fp.on) return; const p = fp.p;
  if (fp.sitting) standUp();
  fp.on = false; fp.p = null; wall.goal = fp.savedWall; fp.stickId = fp.lookId = null; fp.stick.x = fp.stick.y = 0;
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  camera.fov = 38; camera.near = .1; camera.updateProjectionMatrix();
  document.body.classList.remove('fp'); $('fpBar').hidden = true; $('crosshair').hidden = true; $('stick').hidden = true; $('fpPrompt').hidden = true;
  if (p) {
    p.body.root.visible = true; p.task = null;
    camGoal.target.set(p.pos.x, 0, p.pos.z); camState.target.copy(camGoal.target);
    camGoal.dist = camState.dist = 12; camGoal.pitch = camState.pitch = .75; camGoal.yaw = camState.yaw = p.face + Math.PI;
  }
}
// Public: drop out of first person; the camera stays free-orbiting around the person.
function exitFP() { if (fp.on) setView('free'); }
function seatOK(sp, p) {
  if (sp.shared) return !sp.occupant || sp.occupant === p;
  return !sp.owner || sp.owner === p || sp.owner.state === 'away';
}
function nearestSeat() {
  const p = fp.p; let best = null, bd = 1.15;
  const all = [...interactables.of('desk'), ...interactables.of('conf'), ...interactables.of('dining'), ...interactables.of('lounge'), ...interactables.of('bar'), ...interactables.of('booth')];
  for (const sp of all) { if (!seatOK(sp, p)) continue; const d = Math.hypot(sp.pos.x - p.pos.x, sp.pos.z - p.pos.z); if (d < bd) { bd = d; best = sp; } }
  return best;
}
function sitDown(sp) {
  const p = fp.p; if (sp.shared) sp.occupant = p;
  fp.sitting = sp; p.pos.copy(sp.pos); fp.yaw = sp.face; fp.pitch = -.12;
  const anim = sp.game ? 'game' : sp.kind === 'desk' ? (sp.owner === p ? 'type' : 'listenSit') : sp.kind === 'booth' ? 'phone' : sp.kind === 'bar' ? 'drinkSit' : 'listenSit';
  p.task = { kind: 'playerSit', spot: sp, anim };
  p.body.pad.visible = !!sp.game; p.body.phone.visible = sp.kind === 'booth'; p.body.mug.visible = sp.kind === 'bar';
}
function standUp() {
  const p = fp.p, sp = fp.sitting; if (!sp) return;
  if (sp.shared && sp.occupant === p) sp.occupant = null;
  p.pos.copy(sp.approach); fp.sitting = null; p.task = null;
  p.body.pad.visible = p.body.phone.visible = p.body.mug.visible = false;
}
function toggleSit() { if (!fp.on) return; if (fp.sitting) standUp(); else { const sp = nearestSeat(); if (sp) sitDown(sp); } fpPrompts(); }
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const centerNdc = new THREE.Vector2(0, 0);
function fpPrompts() {
  let act = '';
  if (fp.sitting) act = 'Stand up';
  else { const sp = nearestSeat(); if (sp) act = `Sit${sp.place ? ' at ' + (sp.kind === 'desk' && sp.owner === fp.p ? 'your desk' : sp.place) : ''}`; }
  const b = $('fpAct'); b.hidden = !act; if (act) b.textContent = coarse ? act : `${act}  (E)`;
  ray.setFromCamera(centerNdc, camera);
  const hits = ray.intersectObjects(people.filter(q => q.state !== 'away' && q !== fp.p).map(q => q.body.root), true);
  const h = hits.find(x => x.object.userData.person && x.distance < 7);
  const who = h ? `<b>${esc(h.object.userData.person.name)}</b> · ${esc(statusText(h.object.userData.person))}` : '';
  if ($('fpLook').innerHTML !== who) $('fpLook').innerHTML = who;
}
function fpLook(dx, dy) { fp.yaw -= dx * .0035; fp.pitch = Math.max(-1.2, Math.min(1.2, fp.pitch - dy * .0035)); }
function fpPointerDown(e) {
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  if (e.pointerType === 'touch' && e.clientX < innerWidth * .45 && e.clientY > innerHeight * .45 && fp.stickId === null) {
    fp.stickId = e.pointerId; fp.stickO = { x: e.clientX, y: e.clientY };
    const st = $('stick'); st.style.left = (e.clientX - 60) + 'px'; st.style.bottom = (innerHeight - e.clientY - 60) + 'px';
  } else {
    fp.lookId = e.pointerId; fp.lx = e.clientX; fp.ly = e.clientY;
    if (e.pointerType === 'mouse' && !document.pointerLockElement && el.requestPointerLock) { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  }
  e.preventDefault();
}
function fpPointerMove(e) {
  if (document.pointerLockElement === el && e.pointerType === 'mouse') { fpLook(e.movementX, e.movementY); return; }
  if (e.pointerId === fp.stickId) {
    let dx = (e.clientX - fp.stickO.x) / 50, dy = (e.clientY - fp.stickO.y) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    fp.stick.x = dx; fp.stick.y = dy; $('knob').style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  } else if (e.pointerId === fp.lookId) { fpLook(e.clientX - fp.lx, e.clientY - fp.ly); fp.lx = e.clientX; fp.ly = e.clientY; }
}
function fpPointerUp(e) {
  if (e.pointerId === fp.stickId) { fp.stickId = null; fp.stick.x = fp.stick.y = 0; $('knob').style.transform = ''; const st = $('stick'); st.style.left = ''; st.style.bottom = ''; }
  if (e.pointerId === fp.lookId) fp.lookId = null;
}
function fpUpdate(dt) {
  const p = fp.p; if (!p) return;
  let f = 0, r = 0, turn = 0;
  if (keys.has('w') || keys.has('arrowup')) f += 1; if (keys.has('s') || keys.has('arrowdown')) f -= 1;
  if (keys.has('a')) r -= 1; if (keys.has('d')) r += 1;
  if (keys.has('arrowleft')) turn += 1; if (keys.has('arrowright')) turn -= 1;
  f -= fp.stick.y; r += fp.stick.x;
  fp.yaw += turn * 2.2 * dt;
  const len = Math.hypot(f, r); let moved = 0;
  if (len > .08 && fp.sitting) standUp();
  if (len > .08) {
    const sp = 1.5 * (keys.has('shift') ? 2 : 1) * Math.min(1, len) * dt;
    const fx = Math.sin(fp.yaw), fz = Math.cos(fp.yaw), rx = -Math.cos(fp.yaw), rz = Math.sin(fp.yaw);
    const dx = (fx * f + rx * r) / len * sp, dz = (fz * f + rz * r) / len * sp;
    const ox = p.pos.x, oz = p.pos.z, free0 = !walkPx(ox / S + OX, oz / S + OY);
    const ok = (x, z) => free0 || walkPx(x / S + OX, z / S + OY);
    if (ok(ox + dx, oz + dz)) { p.pos.x += dx; p.pos.z += dz; } else if (ok(ox + dx, oz)) p.pos.x += dx; else if (ok(ox, oz + dz)) p.pos.z += dz;
    for (const q of people) {
      if (q === p || q.state === 'away') continue;
      const ddx = p.pos.x - q.pos.x, ddz = p.pos.z - q.pos.z, d = Math.hypot(ddx, ddz);
      if (d > 0 && d < .42) { const nx = p.pos.x + ddx / d * (.42 - d), nz = p.pos.z + ddz / d * (.42 - d); if (ok(nx, nz)) { p.pos.x = nx; p.pos.z = nz; } }
    }
    moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
  }
  fp.moving = moved > 1e-4; p.walkPhase += moved * 4.6; p.animT += dt;
  p.face = p.faceGoal = fp.sitting ? fp.sitting.face : fp.yaw;
  const eyeGoal = (fp.sitting ? 1.2 : 1.6) * p.spec.scale; fp.eye += (eyeGoal - fp.eye) * (1 - Math.exp(-dt * 8));
  const bob = fp.moving ? Math.abs(Math.sin(p.walkPhase)) * .03 : 0;
  camera.position.set(p.pos.x + Math.sin(fp.yaw) * .1, fp.eye + bob, p.pos.z + Math.cos(fp.yaw) * .1);
  const cp = Math.cos(fp.pitch);
  camera.lookAt(camera.position.x + Math.sin(fp.yaw) * cp, camera.position.y + Math.sin(fp.pitch), camera.position.z + Math.cos(fp.yaw) * cp);
  fp.acc += dt; if (fp.acc > .2) { fp.acc = 0; fpPrompts(); }
}

let coarse;

function initFirstPerson() {
  coarse = matchMedia('(pointer: coarse)').matches;
  $('fpAct').onclick = toggleSit;
  $('fpExit').onclick = exitFP;
  addEventListener('keydown', e => {
    if (!fp.on || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'e' && !e.repeat) toggleSit();
    if (k === 'escape' && !document.pointerLockElement) exitFP();
  });
}

export { enterFP, exitFP, leaveFP, fp, fpPointerDown, fpPointerMove, fpPointerUp, fpUpdate, initFirstPerson };
