import { TAU } from '../core/util.js';
import { normalizeSpec } from '../character/spec.js';
import { fitTetoModel, loadTetoModel } from '../character/tetoModel.js';
import { roster } from './roster.js';
import { addLog, deskPool, people } from '../sim/state.js';
import { endTask } from '../sim/tasks.js';
import { TETO_SEAT } from '../world/furniture/desks.js';

// Kasane Teto: a hand-made character with her own 3D model, never more than one. Without the staff list she is the
// 15th person made; with it she comes in after every employee has a desk, if one is left (see makePerson), so she
// never takes an employee's place. She sits at Desk F8 unless an employee has chosen it.
// Her card (ui/teto.js) lets you make her do the Tetoris dance or play as her.
const TETO_NAME = 'Kasane Teto';
const TETO_ROLE = 'Software Engineer QA Senior';
const TETO_INDEX = 14;
// Her look on the shared rig, shown until her own model has loaded.
const TETO_LOOK = {
  type: 'chibi', name: 'Teto', body: 'female', build: 'average', height: 'tall', skin: '#f6dcc6', eyes: { style: 'big', color: '#c8203a' },
  hair: { style: 'pigtails', color: '#d8344f' }, top: { style: 'jacket', color: '#4b4f58' }, bottom: { style: 'skirt', color: '#3a3d45' },
  shoes: { style: 'boots', color: '#b3243a' }, accessories: ['glasses', { type: 'headphones', color: '#2b3138' }],
};

const hasTeto = () => people.some(q => q.isTeto);
// Without the staff list: is the next made-up person Teto? With it: is she still to come, once the staff are in?
const isTetoNext = () => !roster.list && people.length === TETO_INDEX && !hasTeto();
const tetoAfterStaff = () => !!roster.list && !hasTeto();
const npcTeto = () => people.find(q => q.isTeto);
const tetoSpec = () => normalizeSpec(TETO_LOOK);
// Who she is, in the shape makePerson expects.
function tetoWho() {
  return { name: TETO_NAME, role: TETO_ROLE, title: TETO_ROLE, userId: null, department: null, desk: null, shift: null, spec: tetoSpec(), isTeto: true };
}
// Her desk, unless taken or an employee chose it; then any free desk that isn't a department's or chosen by someone.
function tetoSeat() {
  const chosen = new Set((roster.list ?? []).map(e => e.desk).filter(Boolean));
  return deskPool.find(s => s.deskId === TETO_SEAT && !s.owner && !chosen.has(s.deskId))
    ?? deskPool.find(s => !s.owner && !s.department && !chosen.has(s.deskId)) ?? null;
}

// Put her real model on a body (NPC Teto, or the player playing as her) once it has loaded. `stillWanted`
// says whether that body still wants it by then.
function attachTeto(p, stillWanted = () => people.includes(p)) {
  const body = p.body;
  loadTetoModel().then(mesh => {
    if (!stillWanted() || p.body !== body || body.mmd) return;
    mesh.traverse(o => { if (o.isMesh) o.userData.person = p; });
    body.mmd = fitTetoModel(mesh, body);
    p.portrait = null; // her avatar picture is redrawn with the model (ui/teto.js)
  }).catch(e => console.warn('Teto model failed to load; keeping the simple one', e));
}

// NPC Teto leaves the floor (like going home, but she can come back the same day).
function stepAway(n) {
  endTask(n); n.queue = []; n.path = null; n.chatWith = null;
  for (const q of people) if (q.chatWith === n) q.chatWith = null;
  n.state = 'away'; n.body.root.visible = false; n.body.ring.visible = false;
  n.danceK = 0; n.spin = 0;
  if (n.heldProps) { n.heldProps.forEach(k => n.body[k].visible = true); n.heldProps = null; }
}

// ----- Tetoris dance: for 10 seconds she spins in place, arms up -----
const TETORIS = { on: false, until: 0 }; // real-time timer, like the 10-second effects before it
const PROPS = ['mug', 'phone', 'pad', 'putter', 'bucket', 'guitar'];

function startDance() { TETORIS.on = true; TETORIS.until = performance.now() + 10000; addLog('Teto is doing the Tetoris dance'); }

// Per-frame: ease the dance in or out on `t` (whichever Teto is on the floor).
function updateDance(t, dt, now) {
  if (TETORIS.on && (now >= TETORIS.until || t.state === 'away')) { TETORIS.on = false; addLog('Teto finished the Tetoris dance'); }
  t.danceK = (t.danceK || 0) + ((TETORIS.on ? 1 : 0) - (t.danceK || 0)) * (1 - Math.exp(-dt * 5));
  if (TETORIS.on) t.spin = ((t.spin || 0) + dt * TAU * 1.4) % TAU; // ~1.4 turns a second
  else if (t.spin) { const a = Math.atan2(Math.sin(t.spin), Math.cos(t.spin)); t.spin = Math.abs(a) < .01 ? 0 : a * Math.exp(-dt * 6); }
  // put down whatever she was holding while dancing, pick it back up after
  const b = t.body;
  if (t.danceK > .3 && !t.heldProps) { t.heldProps = PROPS.filter(k => b[k].visible); t.heldProps.forEach(k => b[k].visible = false); }
  else if (t.danceK <= .3 && t.heldProps) { t.heldProps.forEach(k => b[k].visible = true); t.heldProps = null; }
}

export { TETORIS, TETO_NAME, attachTeto, isTetoNext, npcTeto, startDance, stepAway, tetoAfterStaff, tetoSeat, tetoSpec, tetoWho, updateDance };
