import { pickAt } from './spots.js';
import { freeCam } from './controller.js';
import { pan, rotate, zoomAt } from './orbit.js';
import { camGoal } from './state.js';
import { angDiff } from '@office/shared';
import { ctl, pointerDown, pointerMove, pointerUp } from '../player/control.js';
import { renderer } from '../render/renderer.js';

const el = renderer.domElement;
const ptrs = new Map(); let downAt = null, lastPinch = 0, lastMid = null, lastAng = null;
const onMove = e => {
  if (ctl.active) { pointerMove(e); return; }
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) { ptrs.delete(e.pointerId); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) {
    // Left-drag moves around the floor; right-drag (or a modifier key) turns and tilts
    if (p.b === 2 || p.b === 1 || p.mod) rotate(dx, dy); else pan(dx, dy);
  } else if (ptrs.size === 2 && [...ptrs.values()].every(q => q.type === 'touch')) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (lastPinch) zoomAt(lastPinch / d, mid.x, mid.y);
    if (lastMid) { pan(mid.x - lastMid.x, 0); camGoal.pitch = Math.max(.25, Math.min(1.5, camGoal.pitch + (mid.y - lastMid.y) * .004)); }
    if (lastAng !== null) camGoal.yaw += angDiff(lastAng, ang);
    lastPinch = d; lastMid = mid; lastAng = ang;
  }
};
const endPtr = e => {
  if (ctl.active) { pointerUp(e); return; }
  const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) { lastPinch = 0; lastMid = null; lastAng = null; }
  if (p && downAt && ptrs.size === 0 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 500) pickAt(e.clientX, e.clientY);
};
// Keyboard: arrows / WASD move, Q E turn, + - zoom
const keys = new Set();
function keyCam(dt) {
  if (!keys.size || ctl.active) return;
  const v = 600 * dt; let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx += v; if (keys.has('arrowright') || keys.has('d')) dx -= v;
  if (keys.has('arrowup') || keys.has('w')) dy += v; if (keys.has('arrowdown') || keys.has('s')) dy -= v;
  if (dx || dy) pan(dx, dy);
  if (keys.has('q')) { camGoal.yaw += 1.6 * dt; freeCam(); } if (keys.has('e')) { camGoal.yaw -= 1.6 * dt; freeCam(); }
  if (keys.has('+') || keys.has('=')) zoomAt(Math.exp(-.8 * dt)); if (keys.has('-') || keys.has('_')) zoomAt(Math.exp(.8 * dt));
}


function initInput() {
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    if (ctl.active) { pointerDown(e); return; }
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    // A mouse or pen is a single pointer: drop anything left over from a missed pointerup
    if (e.pointerType !== 'touch') ptrs.clear();
    else for (const [id, q] of ptrs) if (q.type !== 'touch') ptrs.delete(id);
    ptrs.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY, b: e.button, mod: e.shiftKey || e.ctrlKey || e.altKey || e.metaKey });
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; lastAng = Math.atan2(b.y - a.y, b.x - a.x); }
    e.preventDefault();
  });
  el.addEventListener('pointermove', onMove);
  addEventListener('pointermove', e => { if (ptrs.has(e.pointerId) && e.target !== el) onMove(e); });
  el.addEventListener('pointerup', endPtr);
  addEventListener('pointerup', e => { if (ptrs.has(e.pointerId)) endPtr(e); });
  el.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); lastPinch = 0; lastMid = null; lastAng = null; });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (ctl.active) { if (ctl.holdWheel && ctl.holdWheel(dy)) return; if (ctl.wheelHook) ctl.wheelHook(dy); return; } // (holding something: the wheel raises your hands)
    // Trackpad pinch arrives as ctrl+wheel: zoom. A notched mouse wheel: zoom.
    // A two-finger trackpad swipe: move around the floor, like dragging.
    const notched = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50) || (e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 === 0 && !e.deltaX);
    // Gentle zoom: each wheel notch or pinch step changes the distance by at most ~6%
    const clampF = f => Math.max(.94, Math.min(1.06, f));
    if (e.ctrlKey) { zoomAt(clampF(Math.exp(dy * .004)), e.clientX, e.clientY); return; }
    if (!notched) { pan(-e.deltaX, -e.deltaY); return; }
    zoomAt(clampF(Math.exp(dy * .0005)), e.clientX, e.clientY);
  }, { passive: false });
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_', 'shift'].includes(k)) { keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
}

export { el, keyCam, keys, initInput };
