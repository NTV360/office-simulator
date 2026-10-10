import * as THREE from 'three';
import { CATALOGUE, NONE, REFUSAL_TEXT, canReach, carriedBy, carryOf, holderCount, inReach, movability, nearestGrip, objects, placementProblem, restHeightAt } from '@office/shared';
import { camera } from '../render/renderer.js';
import { ghostOf, itemAt } from '../render/objects.js';
import { BAKED } from '../world/bake.js';
import { ctl } from '../player/control.js';
import { player } from '../player/player.js';
import { $ } from '../ui/dom.js';

// Moving things about, online. Aim at something and take hold of it where you aim (G); the hands go there and lift it. Holding it: a ghost
// shows where it would go, where you look (G puts it down there gently, or lets go of it where it is if that is not a place it may go); hold
// R and move the mouse to turn it in your hands (Shift+R rolls it); the wheel raises and lowers your hands; hold the right button and let go
// to throw it (longer is harder). T puts everything at your desk back. The page only asks: the server holds things with real hands, by the
// same rules (shared/world/arms.ts, placement.ts), and everybody sees what happens. See docs/ITEMS-PHYSICS-PLAN.md, sections 6 and 7.

const state = {
  send: null, acc: 0, candidate: null, grip: null, far: null,
  held: null, turn: new THREE.Quaternion(), raise: 0, dirty: false, sentAt: 0, rKey: false, shift: false, throwFrom: null, target: null, problem: null,
};
const aim = new THREE.Raycaster(), MIDDLE = new THREE.Vector2(0, 0);
aim.far = 6;
/** How far from where you stand a thing can be put down (m): your arm, and the thing's own size. */
const PUT_REACH = 1.2;
/** The longest a throw is wound up (ms): held that long, it is as hard as it gets. */
const WIND_UP = 1000;
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(-1, 0, 0), FORWARD = new THREE.Vector3(0, 0, 1), turnBy = new THREE.Quaternion();

const labelOf = o => (CATALOGUE[o.type]?.label ?? 'thing').toLowerCase();
/** Somebody is carrying it, and it is not a one-hand thing: you can take hold of it too and help (up to four people). */
const joinable = o => o.carriedBy !== null && carryOf(o.type) !== 'one-hand' && holderCount(o) < 4;
/** The way a thing faces now, seen from above. */
const yawOf = o => { if (!o.q) return o.rot; const [x, y, z, w] = o.q; return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)); };

/**
 * The thing G would take hold of, and where: the one under the middle of the screen, at the point aimed at, if a hand gets there; else the
 * nearest one a hand gets to (anyone's: anyone may move anything). `far` is a thing aimed at that is out of reach (to say "step closer").
 */
function pickable(p) {
  aim.setFromCamera(MIDDLE, camera);
  const hit = itemAt(aim);
  let far = null;
  if (hit) {
    const o = objects.at(hit.index);
    if (o && (movability(o) === null || joinable(o))) {
      if (canReach(p, hit.point)) return { o, at: hit.point, far: null };
      far = o;
    }
  }
  let best = null, bd = Infinity;
  for (const o of objects.all()) {
    if (Math.abs(o.x - p.pos.x) > 1.5 || Math.abs(o.z - p.pos.z) > 1.5 || (movability(o) !== null && !joinable(o))) continue;
    const at = nearestGrip(o, p), d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z);
    if (d < bd && canReach(p, at)) { bd = d; best = { o, at, far }; }
  }
  return best ?? { o: null, at: null, far };
}

/**
 * Where what you hold would be put down: the point you look at (on the floor, a desk, a table, another thing), no further from you than you
 * can put it. Its height is what it would stand on there; it keeps the way it faces now.
 */
function putTarget(p, held) {
  aim.setFromCamera(MIDDLE, camera);
  let point = null, best = Infinity;
  const item = itemAt(aim, held.index);
  if (item) { point = item.point; best = item.distance; }
  for (const h of aim.intersectObjects(BAKED, false)) { if (h.distance < best) { point = h.point; best = h.distance; } break; }
  if (!point) { const t = aim.ray.direction.y < -1e-3 ? -aim.ray.origin.y / aim.ray.direction.y : Infinity; if (t < aim.far) point = aim.ray.at(t, new THREE.Vector3()); }
  if (!point) point = new THREE.Vector3(p.pos.x + Math.sin(p.face) * .8, 0, p.pos.z + Math.cos(p.face) * .8);
  let dx = point.x - p.pos.x, dz = point.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > PUT_REACH) { dx *= PUT_REACH / d; dz *= PUT_REACH / d; }
  return { x: p.pos.x + dx, z: p.pos.z + dz, rot: yawOf(held) };
}

function refresh() {
  const p = player.person, on = !!p && ctl.active;
  const held = on ? carriedBy(p.id) : undefined;
  state.candidate = null; state.target = null; state.problem = null;
  if (held !== state.held) { state.held = held ?? null; state.turn.identity(); state.raise = 0; state.dirty = false; state.throwFrom = null; hideGhost(); }
  if (!on) { setPrompt('', false); return; }
  if (held) {
    const t = putTarget(p, held);
    state.target = t;
    state.problem = !inReach(p, t.x, t.z) ? 'too-far' : placementProblem(held, t.x, t.z, t.rot);
    showGhost(held, t, !state.problem);
    const name = labelOf(held);
    if (state.throwFrom !== null) setPrompt(`Throwing the ${name}: let go of the right button`, false);
    else setPrompt(state.problem ? `${REFUSAL_TEXT[state.problem]}  ·  let go  (G)` : `Put the ${name} down here  (G)  ·  turn  (R + mouse)  ·  hands  (wheel)  ·  throw  (hold right button)`, true);
    return;
  }
  const pick = player.sitting ? { o: null, at: null, far: null } : pickable(p);
  state.candidate = pick.o; state.grip = pick.at; state.far = pick.far;
  if (state.candidate) setPrompt(state.candidate.carriedBy !== null ? `Help carry the ${labelOf(state.candidate)}  (G)` : `Pick up the ${labelOf(state.candidate)}  (G)`, true);
  else setPrompt(state.far ? `Step closer to the ${labelOf(state.far)}` : '', false);
}

// ---- the ghost: a see-through copy where the thing would go, green when it may go there, red when not
let ghost = null;
function showGhost(held, t, ok) {
  const g = ghostOf(held);
  if (ghost && ghost !== g) ghost.group.visible = false;
  ghost = g;
  if (!g) return;
  const y = restHeightAt(held, t.x, t.z) ?? 0;
  g.group.position.set(t.x, y, t.z); g.group.rotation.set(0, t.rot, 0);
  g.paint(ok); g.group.visible = true;
}
function hideGhost() { if (ghost) ghost.group.visible = false; ghost = null; }

function setPrompt(text, ok) {
  const b = $('fpObj'); if (!b) return;
  b.hidden = !text; b.textContent = text; b.disabled = !ok;
  const t = $('fpTidy'); if (t) t.hidden = !(ctl.active && player.person?.slot && !carriedBy(player.person.id));
}

function act() {
  const p = player.person; if (!p || !ctl.active || !state.send) return;
  const held = carriedBy(p.id);
  if (held) {
    // what the ghost shows (it is a tenth of a second old at most): green, put it there; red or none, let go of it where it is
    const t = state.held === held ? state.target : null;
    if (t && !state.problem) state.send({ type: 'place', x: t.x, z: t.z, rot: t.rot });
    else state.send({ type: 'drop' });
  } else if (state.candidate) {
    const at = state.grip;
    state.send(at ? { type: 'grab', object: state.candidate.index, at: [at.x, at.y, at.z] } : { type: 'grab', object: state.candidate.index });
    if (at) p.reachTo = { x: at.x, y: at.y, z: at.z, t: performance.now() }; // (the arms go out to it: people/animation.js)
  }
}

// ---- turning it in your hands, raising your hands, throwing: the mouse while something is held
const holding = () => !!(ctl.active && player.person && carriedBy(player.person.id));
function turnIt(dx, dy) {
  if (!state.rKey || !holding()) return false;
  if (state.shift) state.turn.premultiply(turnBy.setFromAxisAngle(FORWARD, dx * .006)); // roll
  else { state.turn.premultiply(turnBy.setFromAxisAngle(UP, -dx * .006)); state.turn.premultiply(turnBy.setFromAxisAngle(RIGHT, dy * .006)); }
  state.turn.normalize(); state.dirty = true;
  return true;
}
function raiseHands(dy) {
  if (!holding()) return false;
  state.raise = Math.max(-.6, Math.min(.6, state.raise - dy * .0008));
  state.dirty = true;
  return true;
}
function windUp(down) {
  if (!holding()) { state.throwFrom = null; return false; }
  if (down) { state.throwFrom = performance.now(); return true; }
  if (state.throwFrom === null) return false;
  const power = Math.min(1, (performance.now() - state.throwFrom) / WIND_UP);
  state.throwFrom = null;
  state.send?.({ type: 'throw', power });
  return true;
}
/** How it is held goes to the server when it changes, at most ten times a second. */
function sendHold() {
  if (!state.dirty || !state.send || performance.now() - state.sentAt < 100) return;
  const q = state.turn;
  state.send({ type: 'hold', turn: [q.x, q.y, q.z, q.w], raise: state.raise });
  state.dirty = false; state.sentAt = performance.now();
}

/** Wire the keys, the mouse and the buttons. `send` puts a message on the wire. */
export function initObjectControls({ send }) {
  state.send = send;
  $('fpObj').onclick = act;
  $('fpTidy').onclick = () => send({ type: 'reset', scope: 'station', object: NONE });
  ctl.holdLook = turnIt; ctl.holdWheel = raiseHands; ctl.holdPress = windUp;
  addEventListener('keydown', e => {
    if (e.key === 'Shift') state.shift = true;
    if (!ctl.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') act();
    else if (k === 'r') state.rKey = true;
    else if (k === 't' && player.person?.slot && !carriedBy(player.person.id)) send({ type: 'reset', scope: 'station', object: NONE });
  });
  addEventListener('keyup', e => { if (e.key === 'Shift') state.shift = false; if (e.key.toLowerCase() === 'r') state.rKey = false; });
  addEventListener('blur', () => { state.rKey = false; state.shift = false; state.throwFrom = null; });
}

/** Every frame, cheaply: how it is held goes out when it changes; the ghost and the prompt are refreshed a few times a second. */
export function tickObjectControls(dt) {
  state.acc += dt;
  sendHold();
  // (for the browser checks: where G would put it, and whether it may go there: the ghost green, or red)
  if (state.acc > .1) { state.acc = 0; refresh(); if (window.__sim) window.__sim.objectAim = state.target && { ...state.target, ok: !state.problem }; }
}
