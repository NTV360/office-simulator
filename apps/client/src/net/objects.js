import * as THREE from 'three';
import { CATALOGUE, NONE, REFUSAL_TEXT, canReach, carriedBy, inReach, movability, nearestGrip, objects, placementProblem, restHeightAt, wrapAngle } from '@office/shared';
import { camera, scene } from '../render/renderer.js';
import { itemAt } from '../render/objects.js';
import { ctl } from '../player/control.js';
import { player } from '../player/player.js';
import { $ } from '../ui/dom.js';

// Moving things about, online: take hold of the thing you aim at, where you aim at it (G), turn it (R), put it down where the ring shows
// (G again), put everything at your desk back (T). With nothing under the aim, the nearest thing in reach. The page only asks; the server
// decides (apps/server/src/play/object-actions.ts) with the same rules (shared/world/arms.ts, placement.ts), which is why the prompt can say
// at once whether a hand gets there. What was done reaches everybody as an `object` message. See docs/ITEMS-PHYSICS-PLAN.md, section 6.

const state = { send: null, rot: null, target: null, problem: null, candidate: null, grip: null, far: null, acc: 0 };
const aim = new THREE.Raycaster(), MIDDLE = new THREE.Vector2(0, 0);
aim.far = 6;
const ring = new THREE.Mesh(new THREE.RingGeometry(.2, .3, 28), new THREE.MeshBasicMaterial({ color: 0x55a274, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 3;

const labelOf = o => (CATALOGUE[o.type]?.label ?? 'thing').toLowerCase();

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
    if (o && movability(o) === null) {
      if (canReach(p, hit.point)) return { o, at: hit.point, far: null };
      far = o;
    }
  }
  let best = null, bd = Infinity;
  for (const o of objects.all()) {
    if (Math.abs(o.x - p.pos.x) > 1.5 || Math.abs(o.z - p.pos.z) > 1.5 || movability(o) !== null) continue;
    const at = nearestGrip(o, p), d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z);
    if (d < bd && canReach(p, at)) { bd = d; best = { o, at, far }; }
  }
  return best ?? { o: null, at: null, far };
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
    ring.visible = true; ring.position.set(x, (restHeightAt(holding, x, z) ?? holding.home.y) + .03, z);
    ring.material.color.setHex(state.problem ? 0xd66f5a : 0x55a274);
    setPrompt(state.problem ? REFUSAL_TEXT[state.problem] : `Put the ${labelOf(holding)} down here  (G)  ·  turn  (R)`, !state.problem);
    return;
  }
  state.rot = null; ring.visible = false;
  const pick = player.sitting ? { o: null, at: null, far: null } : pickable(p);
  state.candidate = pick.o; state.grip = pick.at; state.far = pick.far;
  if (state.candidate) setPrompt(`Pick up the ${labelOf(state.candidate)}  (G)`, true);
  else setPrompt(state.far ? `Step closer to the ${labelOf(state.far)}` : '', false);
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
  else if (state.candidate) {
    const at = state.grip;
    state.send(at ? { type: 'grab', object: state.candidate.index, at: [at.x, at.y, at.z] } : { type: 'grab', object: state.candidate.index });
    if (at) p.reachTo = { x: at.x, y: at.y, z: at.z, t: performance.now() }; // (the arms go out to it: people/animation.js)
  }
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
  if (ring.visible) { const p = player.person, holding = p && carriedBy(p.id); if (holding) { const at = aimAt(p, holding); ring.position.set(at.x, (restHeightAt(holding, at.x, at.z) ?? holding.home.y) + .03, at.z); } }
  if (state.acc > .1) { state.acc = 0; refresh(); }
}
