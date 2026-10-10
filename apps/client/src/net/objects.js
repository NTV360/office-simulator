import * as THREE from 'three';
import { CATALOGUE, NONE, REACH, REFUSAL_TEXT, carriedBy, interactables, inReach, movability, objects, people, placementProblem, wrapAngle } from '@office/shared';
import { scene } from '../render/renderer.js';
import { ctl } from '../player/control.js';
import { player } from '../player/player.js';
import { $ } from '../ui/dom.js';

// Moving things about, online: pick up the nearest chair or small thing in reach (G), turn it (R), put it down where the ring shows
// (G again), put everything at your desk back (T). The page only asks; the server decides (apps/server/src/play/object-actions.ts) with
// the same rules (shared/world/placement.ts), which is why the ring can say at once whether a place is allowed. What was done reaches
// everybody as an `object` message. See docs/PHASE-5-BREAKDOWN.md, step 4.

const state = { send: null, rot: null, target: null, problem: null, candidate: null, acc: 0 };
const ring = new THREE.Mesh(new THREE.RingGeometry(.2, .3, 28), new THREE.MeshBasicMaterial({ color: 0x55a274, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 3;

/** Does the desk of this object's station belong to the person this page plays? (A thing in a shared area belongs to nobody.) */
function mine(o) {
  if (!o.station) return true;
  const desk = interactables.all().find(s => s.id === o.station);
  return !!desk && desk.owner === player.person;
}
const labelOf = o => (CATALOGUE[o.type]?.label ?? 'thing').toLowerCase();

/** The thing G would pick up: the nearest one in reach that is free, and whose desk is yours (or nobody's). */
function nearestPickable(p) {
  let best = null, bd = REACH;
  for (const o of objects.all()) {
    if (movability(o) !== null || !mine(o)) continue;
    const d = Math.hypot(o.x - p.pos.x, o.z - p.pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Where what is carried would go: a step in front of the person (closer for a small thing, which has to land on a desk). */
function aimAt(p, holding) {
  const reach = CATALOGUE[holding.type]?.rests === 'surface' ? .6 : 1.0;
  return { x: p.pos.x + Math.sin(p.face) * reach, z: p.pos.z + Math.cos(p.face) * reach, rot: state.rot ?? holding.rot };
}

function refresh() {
  const p = player.person, on = !!p && ctl.active;
  const holding = on ? carriedBy(p.id) : undefined;
  state.candidate = null; state.target = null; state.problem = null;
  if (!on) { ring.visible = false; setPrompt('', false); return; }
  if (holding) {
    if (state.rot === null) state.rot = holding.rot;
    const at = aimAt(p, holding), { x, z } = at;
    state.target = at;
    state.problem = !inReach(p, x, z) ? 'too-far' : placementProblem(holding, x, z, state.rot);
    ring.visible = true; ring.position.set(x, (holding.y || 0) + .03, z);
    ring.material.color.setHex(state.problem ? 0xd66f5a : 0x55a274);
    setPrompt(state.problem ? REFUSAL_TEXT[state.problem] : `Put the ${labelOf(holding)} down here  (G)  ·  turn  (R)`, !state.problem);
    return;
  }
  state.rot = null; ring.visible = false;
  state.candidate = player.sitting ? null : nearestPickable(p);
  setPrompt(state.candidate ? `Pick up the ${labelOf(state.candidate)}  (G)` : '', !!state.candidate);
}

function setPrompt(text, ok) {
  const b = $('fpObj'); if (!b) return;
  b.hidden = !text; b.textContent = text; b.disabled = !ok && !!state.target; // a refused place is shown, not clickable
  const t = $('fpTidy'); if (t) t.hidden = !(ctl.active && player.person?.slot && !carriedBy(player.person.id));
}

function act() {
  const p = player.person; if (!p || !ctl.active || !state.send) return;
  const holding = carriedBy(p.id);
  if (holding) { const at = aimAt(p, holding); if (!placementProblem(holding, at.x, at.z, at.rot)) state.send({ type: 'place', x: at.x, z: at.z, rot: at.rot }); } // (aimed again now: you may have moved since the last look)
  else if (state.candidate) state.send({ type: 'grab', object: state.candidate.index });
}

/** Wire the keys and buttons. `send` puts a message on the wire. */
export function initObjectControls({ send }) {
  state.send = send;
  scene.add(ring);
  $('fpObj').onclick = act;
  $('fpTidy').onclick = () => send({ type: 'reset', scope: 'station', object: NONE });
  addEventListener('keydown', e => {
    if (!ctl.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') act();
    else if (k === 'r' && state.rot !== null) state.rot = wrapAngle(state.rot + Math.PI / 4);
    else if (k === 't' && player.person?.slot && !carriedBy(player.person.id)) send({ type: 'reset', scope: 'station', object: NONE });
  });
}

/** Every frame, cheaply: the ring follows you, the prompt is refreshed a few times a second. */
export function tickObjectControls(dt) {
  state.acc += dt;
  if (ring.visible) { const p = player.person, holding = p && carriedBy(p.id); if (holding) { const at = aimAt(p, holding); ring.position.set(at.x, (holding.y || 0) + .03, at.z); } }
  if (state.acc > .1) { state.acc = 0; refresh(); }
}
