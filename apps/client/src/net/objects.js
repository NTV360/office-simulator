import * as THREE from 'three';
import { CATALOGUE, MEDKIT_REACH, NONE, REACH, REFUSAL_TEXT, angDiff, canReach, carriedBy, carryOf, freeSitOccupied, holderCount, inReach, movability, objects, placementProblem, restHeightAt, throwPath, throwVelocity } from '@office/shared';
import { camera, scene } from '../render/renderer.js';
import { drawnInfo, ghostOf, highlightItem, itemAt, shownAt } from '../render/objects.js';
import { BAKED } from '../world/bake.js';
import { ctl } from '../player/control.js';
import { player } from '../player/player.js';
import { $ } from '../ui/dom.js';
import { medboxOpen, toggleMedbox } from '../ui/medbox.js';
import { careHint, careItem, careKey } from './care.js';

// Moving things about, online. Aim at something and take hold of it where you aim (G); the hands go there and lift it. Holding it: a ghost
// shows where it would go, where you look (G puts it down there gently, or lets go of it where it is if that is not a place it may go); hold
// R and move the mouse to turn it in your hands (Shift+R rolls it); hold Z and turn the wheel to raise and lower your hands (the wheel alone zooms); hold the right button and let go
// to throw it (turn the wheel meanwhile to set how hard; Esc calls it off). T puts everything at your desk back. The page only asks: the server holds things with real hands, by the
// same rules (shared/world/arms.ts, placement.ts), and everybody sees what happens. See docs/ITEMS-PHYSICS-PLAN.md, sections 6 and 7.

const state = {
  send: null, acc: 0, candidate: null, grip: null, far: null,
  held: null, turn: new THREE.Quaternion(), raise: 0, dirty: false, sentAt: 0, rKey: false, zKey: false, shift: false, throwing: false, power: .5, turning: null, target: null, problem: null,
  pickup: null, store: null, medkit: null,
};
const PICKUP_HOLD_MS = 500;
const aim = new THREE.Raycaster(), MIDDLE = new THREE.Vector2(0, 0);
aim.far = 6;
/** How far from where you stand a thing can be put down (m): your arm, and the thing's own size. */
// The ghost stops a little inside the real reach: the server measures from where the player really is, which can lag the page by a few
// centimetres, and a target exactly at the edge would be refused as "too far" although the ghost showed green.
const PUT_REACH = REACH - .3;
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(-1, 0, 0), FORWARD = new THREE.Vector3(0, 0, 1), turnBy = new THREE.Quaternion();

const labelOf = o => (CATALOGUE[o.type]?.label ?? 'thing').toLowerCase();
/** Somebody is carrying it, and it is not a one-hand thing: you can take hold of it too and help (up to four people). */
const joinable = o => o.carriedBy !== null && carryOf(o.type) !== 'one-hand' && holderCount(o) < 4;
/** The way a thing faces now, seen from above. */
const yawOf = o => { if (!o.q) return o.rot; const [x, y, z, w] = o.q; return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)); };

/**
 * The thing G would take hold of, and where: the one under the cursor (the middle of the screen), at the point aimed at, if a hand gets
 * there. Nothing else: not the one nearest it. In third person the view starts behind you, so what is between the camera and you (the chair
 * you stand in front of) does not count, and nothing counts behind a wall or a desk. Anyone's: anyone may move anything. `far` is a thing
 * aimed at that is out of reach (to say "step closer").
 */
function pickable(p) {
  aim.setFromCamera(MIDDLE, camera);
  const r = aim.ray, from = ctl.mode === 'fp' ? 0 : Math.max(0, (p.pos.x - r.origin.x) * r.direction.x + (1 - r.origin.y) * r.direction.y + (p.pos.z - r.origin.z) * r.direction.z - .3);
  const hit = itemAt(aim, -1, from);
  if (window.__sim) window.__sim.rayHit = hit ? { index: hit.index, distance: hit.distance, from } : null; // (for checks)
  if (!hit) return { o: null, at: null, far: null };
  for (const h of aim.intersectObjects(BAKED, false)) { if (h.distance >= from) { if (h.distance < hit.distance - .02) return { o: null, at: null, far: null }; break; } }
  const o = objects.at(hit.index);
  // the medkit on the counter is not picked up: E opens its menu (when you are close enough)
  if (o && o.type === 'medkit-box' && !o.removed) return Math.hypot(o.x - p.pos.x, o.z - p.pos.z) <= MEDKIT_REACH ? { o: null, at: null, far: null, medkit: o } : { o: null, at: null, far: o };
  if (!o || (freeSitOccupied(o)) || (movability(o) !== null && !joinable(o))) return { o: null, at: null, far: null };
  return canReach(p, hit.point) ? { o, at: hit.point, far: null } : { o: null, at: null, far: o };
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
  // Keep the empty-hand representation stable. `state.held` uses null, while
  // carriedBy returns undefined when empty; mixing them cancels every pending E
  // hold on the next refresh and makes pickup appear to do nothing.
  const held = on ? (carriedBy(p.id) ?? null) : null;
  state.candidate = null; state.target = null; state.problem = null; state.medkit = null;
  // Network snapshots may replace an object record without changing what is held.
  // Compare stable indexes so a refresh cannot cancel an in-progress E hold.
  const heldChanged = (held?.index ?? null) !== (state.held?.index ?? null);
  if (heldChanged) { state.turn.identity(); state.raise = 0; state.dirty = false; state.throwing = false; cancelPickup(); state.store = null; hideGhost(); hideArc(); }
  state.held = held ?? null;
  if (!on) { cancelPickup(); setPrompt('', false); highlightItem(null); return; }
  if (held) {
    const t = putTarget(p, held);
    state.target = t;
    state.problem = !inReach(p, t.x, t.z) ? 'too-far' : placementProblem(held, t.x, t.z, t.rot);
    showGhost(held, t, !state.problem);
    highlightItem(null);
    const name = labelOf(held);
    if (state.throwing) { hideGhost(); showArc(); setPrompt(`Throwing the ${name}: look up to lob it, level to throw it straight  ·  wheel: how hard  ·  let go of the right button  ·  Esc calls it off`, false); }
    else {
      const storeProgress = state.store ? `  (${Math.min(100, Math.floor((performance.now() - state.store.started) / PICKUP_HOLD_MS * 100))}%)` : '';
      setPrompt(state.problem ? `${REFUSAL_TEXT[state.problem]}  ·  let go  (G)` : `Put the ${name} down here  (G)  ·  store in inventory (hold E${storeProgress})  ·  turn (R + mouse)  ·  throw (hold right button)`, true);
    }
    return;
  }
  const pick = player.sitting ? { o: null, at: null, far: null } : pickable(p);
  state.candidate = pick.o; state.grip = pick.at; state.far = pick.far; state.medkit = pick.medkit ?? null;
  // Once E captures a concrete target, keep that request stable for its 500 ms
  // hold. The server revalidates identity, reach, and occupancy authoritatively;
  // a changing camera ray must not cancel the user's deliberate interaction.
  highlightItem(state.candidate ?? state.medkit); // (the thing E would take hold of, or open: outlined on this page only)
  if (state.candidate) {
    const progress = state.pickup ? `  (${Math.min(100, Math.floor((performance.now() - state.pickup.started) / PICKUP_HOLD_MS * 100))}%)` : '';
    setPrompt(state.candidate.carriedBy !== null ? `Help carry the ${labelOf(state.candidate)}  (hold E${progress})` : `Pick up the ${labelOf(state.candidate)}  (hold E${progress})`, true);
  }
  else if (state.medkit) setPrompt(medboxOpen() ? 'Close the medkit  (E)' : 'Open the medkit  (E)', true);
  else if (state.far) setPrompt(`Step closer to the ${labelOf(state.far)}`, false);
  else setPrompt(careItem() ? careHint() : '', false);
}

// ---- the throw's path: where it will fly, drawn while the right button is held (by the same rules the server throws it by: shared/world/throw.ts)
/** Which way you look: the middle of the screen. */
function lookDir() {
  aim.setFromCamera(MIDDLE, camera);
  const d = aim.ray.direction;
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
}
const ARC_MAX = 120;
let arc = null;
function makeArc() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_MAX * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffc34d, dashSize: .12, gapSize: .08, depthTest: false, transparent: true, opacity: .9 }));
  line.renderOrder = 3; line.frustumCulled = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.12, .2, 24), new THREE.MeshBasicMaterial({ color: 0xffc34d, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .9 }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3;
  scene.add(line); scene.add(ring);
  return { line, ring, cast: new THREE.Raycaster(), a: new THREE.Vector3(), b: new THREE.Vector3() };
}
function showArc() {
  const p = player.person, held = p && carriedBy(p.id);
  if (!held) { hideArc(); return; }
  arc ??= makeArc();
  const at = shownAt(held.index) ?? { x: held.x, y: held.y, z: held.z }, { yaw, pitch } = lookDir();
  const { cast, a, b } = arc;
  const hit = (u, v) => { // (stops where it meets the room: a wall, a desk)
    a.set(u.x, u.y, u.z); b.set(v.x - u.x, v.y - u.y, v.z - u.z);
    const len = b.length(); if (len < 1e-6) return false;
    cast.set(a, b.divideScalar(len)); cast.far = len;
    return cast.intersectObjects(BAKED, false).length > 0;
  };
  const path = throwPath(held, { x: at.x, y: at.y, z: at.z }, throwVelocity(held, state.power, yaw, pitch), hit).slice(0, ARC_MAX);
  const pos = arc.line.geometry.attributes.position;
  path.forEach((q, i) => pos.setXYZ(i, q.x, q.y, q.z));
  pos.needsUpdate = true; arc.line.geometry.setDrawRange(0, path.length); arc.line.computeLineDistances();
  const end = path[path.length - 1];
  if (window.__sim) window.__sim.throwArc = { from: path[0], end, n: path.length, yaw, pitch, power: state.power }; // (for checks)
  arc.ring.position.set(end.x, end.y + .02, end.z);
  arc.line.visible = arc.ring.visible = true;
}
function hideArc() { if (arc) arc.line.visible = arc.ring.visible = false; }

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
  const store = $('fpStore');
  if (store) {
    // Inventory storage is the second phase of E: only the object already in our hands may be stored.
    const held = ctl.active && player.person ? carriedBy(player.person.id) : undefined;
    const canStore = !!held && !player.sitting && !held.removed;
    store.hidden = !canStore;
    store.disabled = !canStore;
    store.textContent = canStore ? `Store the ${labelOf(held)} in inventory (hold E)` : '';
  }
}

function cancelPickup() { state.pickup = null; }

function pickupKey(down) {
  const p = player.person;
  if (!down) {
    const handled = !!(state.pickup || state.store);
    cancelPickup();
    state.store = null;
    return careKey(false) || handled; // (letting go also ends any care that was being given)
  }
  if (!p || !ctl.active || player.sitting) return false;
  const held = carriedBy(p.id);
  if (held) {
    if (!state.store) state.store = { index: held.index, started: performance.now() };
    return true;
  }
  if (state.medkit) { toggleMedbox(state.medkit.index); return true; }
  // nothing to pick up or open: with a medical item picked on the hotbar, E starts giving care (hold it)
  if (!state.candidate || !state.grip) return careKey(true);
  if (!state.pickup) state.pickup = {
    index: state.candidate.index,
    at: { x: state.grip.x, y: state.grip.y, z: state.grip.z },
    started: performance.now()
  };
  return true;
}

function sendPickup() {
  const p = player.person, pending = state.pickup, at = pending?.at;
  // The pending index/aim are the deliberate E target. Do not require the
  // current render mirror to contain the object at this exact frame; snapshots
  // can replace it while the authoritative server still has the same index.
  if (!p || !ctl.active || carriedBy(p.id) || player.sitting || !pending || !at) return;
  state.pickup = null;
  state.send?.({ type: 'grab', object: pending.index, at: [at.x, at.y, at.z] });
  p.reachTo = { x: at.x, y: at.y, z: at.z, t: performance.now() };
}

function act() {
  const p = player.person; if (!p || !ctl.active || !state.send) return;
  const held = carriedBy(p.id);
  if (held) {
    // what the ghost shows (it is a tenth of a second old at most): green, put it there; red or none, let go of it where it is
    // Snapshot application may replace the object record while it remains held.
    // Stable indexes preserve the placement target across those replacements.
    const t = state.held?.index === held.index ? state.target : null;
    if (t && !state.problem) state.send({ type: 'place', x: t.x, z: t.z, rot: t.rot });
    else state.send({ type: 'drop' });
  } else if (state.candidate && state.grip && !state.turning) {
    // G remains the immediate/manual object action; E uses the deliberate pickup hold.
    const at = state.grip, heading = Math.atan2(at.x - p.pos.x, at.z - p.pos.z);
    state.turning = { index: state.candidate.index, at, heading, until: performance.now() + TURN_MS };
    ctl.faceTo = heading;
  }
}
/** The longest the turn to face a thing takes before the hands go out to it anyway (ms). */
const TURN_MS = 450;
/** Each frame while turning to take hold of something: once facing it (or after a moment), ask the server to take hold, and reach. */
function turnThenReach() {
  const t = state.turning; if (!t) return;
  const p = player.person;
  if (!p || !ctl.active || carriedBy(p.id) || player.sitting) { state.turning = null; ctl.faceTo = null; return; }
  const facing = ctl.mode === 'fp' ? ctl.yaw : p.face;
  if (Math.abs(angDiff(facing, t.heading)) > .1 && performance.now() < t.until) return;
  state.turning = null; ctl.faceTo = null;
  state.send?.({ type: 'grab', object: t.index, at: [t.at.x, t.at.y, t.at.z] });
  p.reachTo = { x: t.at.x, y: t.at.y, z: t.at.z, t: performance.now() }; // (the arms go out to it: people/animation.js)
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
// (while the right button is held the wheel sets how hard the throw will be; while Z is held it raises your hands; otherwise it is the
// camera's, zooming as always)
function raiseHands(dy) {
  if (state.throwing && holding()) { state.power = Math.max(.05, Math.min(1, state.power - dy * .0005)); showArc(); return true; }
  if (!state.zKey || !holding()) return false;
  state.raise = Math.max(-.6, Math.min(.6, state.raise - dy * .0008));
  state.dirty = true;
  return true;
}
function windUp(down) {
  if (!holding()) { state.throwing = false; return false; }
  if (down) { state.throwing = true; return true; }
  if (!state.throwing) return false;
  state.throwing = false; hideArc();
  const { yaw, pitch } = lookDir();
  state.send?.({ type: 'throw', power: state.power, yaw, pitch }); // (the strength is remembered for the next throw)
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
  $('fpStore').onpointerdown = event => {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
    pickupKey(true);
  };
  const stopStoreHold = event => {
    event.preventDefault();
    event.stopPropagation();
    pickupKey(false);
  };
  $('fpStore').onpointerup = stopStoreHold;
  $('fpStore').onpointercancel = stopStoreHold;
  $('fpStore').onlostpointercapture = stopStoreHold;
  $('fpTidy').onclick = () => send({ type: 'reset', scope: 'station', object: NONE });
  ctl.holdLook = turnIt; ctl.holdWheel = raiseHands; ctl.holdPress = windUp; ctl.pickupHook = pickupKey;
  addEventListener('keydown', e => {
    if (e.key === 'Shift') state.shift = true;
    if (!ctl.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') act();
    else if (k === 'r') state.rKey = true;
    else if (k === 'z') state.zKey = true;
    else if (k === 't' && player.person?.slot && !carriedBy(player.person.id)) send({ type: 'reset', scope: 'station', object: NONE });
  });
  // (Esc while winding up calls the throw off, and does nothing else: caught first, so it does not also leave walking or close a card)
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !state.throwing) return;
    state.throwing = false; hideArc(); e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', e => { if (e.key === 'Shift') state.shift = false; if (e.key.toLowerCase() === 'r') state.rKey = false; if (e.key.toLowerCase() === 'z') state.zKey = false; });
  addEventListener('blur', () => { state.rKey = false; state.zKey = false; state.shift = false; state.throwing = false; hideArc(); });
}

/** The throw bar: how hard the throw will be if the right button is let go now (set with the wheel, starting where the last throw was). */
function showWindUp() {
  const bar = $('fpThrow'); if (!bar) return;
  const on = state.throwing;
  if (bar.hidden === on) bar.hidden = !on;
  if (on) $('fpThrowFill').style.width = `${Math.round(state.power * 100)}%`;
}

/** Every frame, cheaply: how it is held goes out when it changes; the throw bar fills; the ghost and the prompt are refreshed a few times a second. */
export function tickObjectControls(dt) {
  state.acc += dt;
  sendHold();
  showWindUp();
  if (state.throwing) showArc();
  turnThenReach();
  // Complete a held pickup before the periodic ray refresh. A transient missed
  // ray must not erase the concrete candidate captured when E was pressed.
  if (state.pickup && performance.now() - state.pickup.started >= PICKUP_HOLD_MS) sendPickup();
  if (state.pickup || state.acc > .1) { state.acc = 0; refresh(); if (window.__sim) { window.__sim.objectAim = state.target && { ...state.target, ok: !state.problem }; window.__sim.objectPick = state.candidate?.index ?? null; window.__sim.medkitPick = state.medkit?.index ?? null; window.__sim.medkitFar = state.far?.type === 'medkit-box'; window.__sim.shownAt ??= shownAt; window.__sim.drawnInfo ??= drawnInfo; } }
  if (state.store && performance.now() - state.store.started >= PICKUP_HOLD_MS) {
    const p = player.person, held = p && carriedBy(p.id);
    if (held && held.index === state.store.index && !held.removed) {
      state.send?.({ type: 'inventory', action: 'assign', revision: p.mechanics.inventoryRevision, object: held.index });
    }
    state.store = null;
  }
}
