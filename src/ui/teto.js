import * as THREE from 'three';
import { follow, setView } from '../camera/controller.js';
import { camGoal } from '../camera/state.js';
import { TETORIS, attachTeto, npcTeto, startDance, stepAway, tetoSpec, updateDance } from '../people/teto.js';
import { ctl, exitPlay } from '../player/control.js';
import { player, setPlayerSpec, spawnPlayer } from '../player/player.js';
import { sitDown, standUp } from '../player/seating.js';
import { addLog, sim } from '../sim/state.js';
import { setDeskScreens } from '../sim/step.js';
import { placeNow } from '../sim/tasks.js';
import { $ } from './dom.js';
import { fmt, select, selected } from './person.js';
import { portrait } from './portrait.js';

/* ================= Kasane Teto's card buttons ================= */
// "Tetoris dance" and "Play as her" (shown only on her card, see renderPerson). Playing as her you take control of
// her in third person (V for first person): your own character waits where it was and NPC Teto steps out so there
// is only one of her. When you leave first/third person she carries on from wherever you left her.
const AS_TETO = { on: false, saved: null, pos: new THREE.Vector3(), face: 0 }; // your own look and spot, put back after
// The Teto on the floor right now: you, while you're playing as her.
const TETO = () => AS_TETO.on ? player.person : npcTeto();

function initTeto() {
  $('pDance').onclick = dance;
  $('pPlay').onclick = playAsTeto;
}

function dance() {
  const t = TETO(); if (!t) return;
  if (t.state === 'away') { addLog(t.arrivedAt ? 'Teto has gone home. The Tetoris dance can wait for tomorrow.' : `Teto isn't in yet, due around ${fmt(t.arriveAt)}`); return; }
  exitPlay();
  startDance();
  follow(t); camGoal.dist = 5; camGoal.pitch = .45; camGoal.yaw = t.face + Math.PI + .4;
}

function playAsTeto() {
  const n = npcTeto(); if (!n || AS_TETO.on) return;
  if (n.state === 'away') { addLog(n.arrivedAt ? 'Teto has already gone home' : `Teto isn't in yet, due around ${fmt(n.arriveAt)}`); return; }
  exitPlay();
  const p = spawnPlayer();
  TETORIS.on = false;
  if (player.sitting) standUp(p);
  AS_TETO.on = true; AS_TETO.saved = player.spec; AS_TETO.pos.copy(p.pos); AS_TETO.face = p.face;
  setPlayerSpec(tetoSpec());
  p.isTeto = true;
  // take over right where she is, seated at her desk if she's working there
  const atDesk = n.state === 'doing' && n.task?.spot === n.seat;
  p.pos.copy(n.pos); p.face = p.faceGoal = n.face;
  stepAway(n); select(null);
  if (atDesk) sitDown(p, n.seat);
  attachTeto(p, () => AS_TETO.on);
  setView('third');
  $('fpWho').textContent = `Walking as ${n.name}`;
  $('fpCreator').hidden = true; // her look isn't yours to edit
  addLog('You are playing as Teto');
}

// Called once you leave first/third person: hand her back to the simulation where you left her.
function stopPlayingAsTeto() {
  const p = player.person, n = npcTeto(), seat = player.sitting;
  TETORIS.on = false;
  if (seat) standUp(p);
  const at = p.pos.clone(), face = p.face;
  AS_TETO.on = false; p.isTeto = false; p.danceK = 0; p.spin = 0; p.heldProps = null;
  setPlayerSpec(AS_TETO.saved); $('fpCreator').hidden = false;
  p.pos.copy(AS_TETO.pos); p.face = p.faceGoal = AS_TETO.face; // your own character is back where you left it
  if (n && sim.t < n.leaveAt) {
    n.arrivedAt = n.arrivedAt || sim.t;
    n.body.root.visible = true; n.body.ring.visible = true;
    if (seat && seat === n.seat) placeNow(n, { kind: 'work', cat: 'work', anim: 'type', spot: n.seat, dur: 20 });
    else { n.state = 'idle'; n.task = null; n.pos.copy(at); n.face = n.faceGoal = face; }
  }
  addLog('Teto is back to her own day');
}

// Per-frame, from the loop.
function updateTeto(dt, now) {
  if (AS_TETO.on && !ctl.active) stopPlayingAsTeto(); // you left first/third person
  const n = npcTeto();
  if (AS_TETO.on && n) {
    if (n.state !== 'away') stepAway(n); // e.g. a new day: she stays out while you're her
    if (player.sitting === n.seat) setDeskScreens(n.seat, n.screenMat); // her monitors work while you sit there as her
  }
  const t = TETO(); if (!t) return;
  if (TETORIS.on && t === player.person) t.animT += dt; // the player is not stepped by the sim, so keep the beat going here
  updateDance(t, dt, now);
  // without a profile photo, her avatar is a picture of her own model (redrawn once the model has loaded)
  if (n && !n.portrait) { const pic = portrait(n); if (!n.photo || n.photo === n.tetoPic) n.photo = pic; n.tetoPic = pic; if (selected === n) select(n); }
  const play = $('pPlay'), label = selected?.userId ? 'Play as Teto' : 'Play as her'; // an employee who is Teto, or Teto herself
  if (play.textContent !== label) play.textContent = label;
  const btn = $('pDance');
  if (TETORIS.on) { btn.disabled = true; btn.textContent = `Spinning… ${Math.ceil((TETORIS.until - now) / 1000)}s`; }
  else if (btn.disabled) { btn.disabled = false; btn.textContent = 'Tetoris dance'; }
}

export { initTeto, updateTeto };
