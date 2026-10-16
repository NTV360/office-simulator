import * as THREE from 'three';
import { keys } from '../camera/input.js';
import { eyeHeight } from '../character/rig.js';
import { ctl } from '../player/control.js';
import { CHORDS, pianoNote, strum } from '../player/instruments.js';
import { player } from '../player/player.js';
import { updatePrompts } from '../player/prompts.js';
import { standUp } from '../player/seating.js';
import { toPx } from '../config/plan.js';
import { walkPx } from '../nav/grid.js';
import { camera, renderer } from '../render/renderer.js';
import { channelName, nextChannel, tvOf, tvScreens } from '../world/furniture/channels.js';
import { MY_DARTS } from '../world/furniture/darts.js';
import { canPutt, golfBall } from '../world/furniture/golf.js';
import { SURFACES, boardStroke, clearBoard } from '../world/furniture/whiteboard.js';
import { $, keyHints, keyed } from './dom.js';
import { inGame, startDarts, startGolf } from './games.js';

/* ================= Using things while walking around ================= */
// In first or third person, aim at a TV and press E to change its channel (world/furniture/channels.js), or at a
// whiteboard to draw on it with the mouse (pens, an eraser, wipe the board); at the dartboard or by the golf ball E
// starts a game of darts or mini golf with its own view (ui/games.js). Sit at the music corner's keyboard
// and your own keyboard plays it; at the guitar the number keys strum chords (player/instruments.js). While you
// draw or play, the keys are the board's or the instrument's (no walking, no shortcuts); Esc puts the pen down or
// gets you up.
const REACH = { tv: 6, board: 3, darts: 5, golf: 2 }; // metres from you
// Your keyboard as a piano: two rows like a real one, semitones above C4 (Z and X move it an octave).
const PIANO = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const KEY_LABEL = { Semicolon: ';', Quote: "'" };
const PENS = [['#25323d', 4], ['#2f6fd6', 4], ['#c8302c', 4], ['#2a8a4a', 4], [null, 30]]; // colour (null: eraser), width in board pixels
const DRAW_AT = 1.4; // metres in front of a whiteboard's middle, to see all of it while drawing
const WALK = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const use = { board: null, normal: new THREE.Vector3(), centre: new THREE.Vector3(), pen: 0, stroke: null, fov: null, inst: null, octave: 0, held: new Map(), aimAcc: 0 };
const ray = new THREE.Raycaster(), centre = new THREE.Vector2(), ndc = new THREE.Vector2(), v = new THREE.Vector3(), q = new THREE.Quaternion();

// What you are aiming at and within reach (player.aim): a TV, a whiteboard or the dartboard, or the golf ball when you
// stand by it. The crosshair picks first; failing that, whatever is nearest the middle of the view, so in third
// person (the crosshair sits beside you) and at small things like the dartboard you need not aim exactly.
const LOOSE = .3; // radians off the middle of the view
function aimTarget(mesh) {
  const tv = tvOf(mesh); if (tv) return { kind: 'tv', target: tv, reach: REACH.tv };
  if (mesh === MY_DARTS.board) return { kind: 'darts', reach: REACH.darts };
  return { kind: 'board', target: SURFACES.find(b => b.mesh === mesh), reach: REACH.board };
}
function aimAt() {
  const p = player.person; player.aim = null;
  if (!ctl.active || !p || p.state !== 'player' || use.board || use.inst || inGame()) return;
  const meshes = [...tvScreens(), ...SURFACES.map(b => b.mesh), MY_DARTS.board], near = (pt, t) => Math.hypot(pt.x - p.pos.x, pt.z - p.pos.z) < t.reach;
  ray.setFromCamera(centre, camera);
  const hit = ray.intersectObjects(meshes, false)[0];
  if (hit) { const t = aimTarget(hit.object); if (near(hit.point, t)) player.aim = t; }
  if (!player.aim) {
    let best = LOOSE;
    for (const m of meshes) {
      const c = m.getWorldPosition(v), t = aimTarget(m); if (!near(c, t)) continue;
      const off = ray.ray.direction.angleTo(c.sub(camera.position)); if (off < best) { best = off; player.aim = t; }
    }
  }
  const ball = golfBall().position;
  if (!player.aim && canPutt() && Math.hypot(ball.x - p.pos.x, ball.z - p.pos.z) < REACH.golf) player.aim = { kind: 'golf' };
}
// E (player/control.js) or the prompt's button: use what you aim at. False when there is nothing (E then sits).
function useAim() {
  const a = player.aim; if (!a) return false;
  if (a.kind === 'tv') nextChannel(a.target);
  else if (a.kind === 'board') startBoard(a.target);
  else if (a.kind === 'darts') startDarts();
  else startGolf();
  return true;
}

function aimText(a) {
  if (a.kind === 'tv') return `Change channel · ${channelName(a.target)}`;
  if (a.kind === 'board') return 'Draw on the whiteboard';
  return a.kind === 'darts' ? 'Play darts' : 'Play mini golf';
}

// ----- drawing on a whiteboard: the mouse cursor draws, the camera faces the board; you can still walk (WASD)
// and zoom (the wheel)
// In first person you draw from your own eyes; in third person you stand at the board's left with your arm up to
// it, and the camera looks at the board over your shoulder from in front of it.
function startBoard(b) {
  Object.assign(use, { board: b, stroke: null, fov: camera.fov }); player.aim = null; keys.clear();
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  const p = player.person, n = use.normal.set(0, 0, 1).applyQuaternion(b.mesh.getWorldQuaternion(q)), c = b.mesh.getWorldPosition(use.centre);
  const tp = ctl.mode === 'tp', back = tp ? 1 : DRAW_AT, side = tp ? -.75 : 0; // (the board's right, seen from the front, is (n.z, -n.x))
  // stand back far enough to see the whole board (unless something is in the way)
  const x = c.x + n.x * back + n.z * side, z = c.z + n.z * back - n.x * side;
  if (walkPx(...toPx(new THREE.Vector3(x, 0, z)))) { p.pos.x = x; p.pos.z = z; }
  ctl.yaw = Math.atan2(c.x - p.pos.x, c.z - p.pos.z); ctl.pitch = Math.atan2(c.y - eyeHeight(p.body), Math.hypot(c.x - p.pos.x, c.z - p.pos.z));
  p.face = p.faceGoal = ctl.yaw; p.task = { kind: 'board', anim: 'drawBoard', drawing: false };
  document.body.classList.add('drawing'); $('boardBar').hidden = false;
}
function endBoard() {
  if (use.fov) { camera.fov = use.fov; camera.updateProjectionMatrix(); }
  const p = player.person; if (p?.task?.kind === 'board') p.task = null;
  Object.assign(use, { board: null, stroke: null, fov: null }); document.body.classList.remove('drawing'); $('boardBar').hidden = true;
}
// Third person, every frame: the camera in front of the board, a little to the right, looking at it.
function boardCamera() {
  const n = use.normal, c = use.centre;
  camera.position.set(c.x + n.x * 2.6 + n.z * .35, c.y + .1, c.z + n.z * 2.6 - n.x * .35); camera.lookAt(c);
  const p = player.person; p.body.root.visible = true; p.task.drawing = !!use.stroke;
}
// The wheel zooms while drawing.
function boardZoom(e) {
  if (!use.board) return;
  e.preventDefault(); e.stopImmediatePropagation();
  camera.fov = Math.max(25, Math.min(80, camera.fov * Math.exp(e.deltaY * .001))); camera.updateProjectionMatrix();
}
// Where the mouse is on the board, as 0-1 across and down (null: off its front).
function boardPoint(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(use.board.mesh, false)[0];
  return hit?.uv && hit.face.normal.z > .5 ? { u: hit.uv.x, v: 1 - hit.uv.y } : null;
}
function draw(pt) { const [color, width] = PENS[use.pen], s = use.stroke; boardStroke(use.board, s.u, s.v, pt.u, pt.v, color, width); s.u = pt.u; s.v = pt.v; }
// The canvas's pointer, before camera/input.js and player/control.js see it: drawing, not looking around.
function boardPointer(e) {
  if (!use.board) return;
  e.stopImmediatePropagation();
  if (e.type === 'pointerdown') {
    e.preventDefault(); if (e.button !== 0) return;
    const pt = boardPoint(e); if (!pt) return;
    use.stroke = { id: e.pointerId, ...pt }; try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
    draw(pt); // a dot
  } else if (e.type === 'pointermove') { if (use.stroke?.id === e.pointerId) { const pt = boardPoint(e); if (pt) draw(pt); } }
  else if (use.stroke?.id === e.pointerId) use.stroke = null;
}
function pickPen(i) { use.pen = i; document.querySelectorAll('[data-pen]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.pen === i))); }

// ----- playing the keyboard or the guitar you sit at
function setInstrument(kind) {
  for (const code of [...use.held.keys()]) playKey(code, false);
  use.inst = kind; keys.clear();
  document.body.classList.toggle('playing', !!kind); $('instPanel').hidden = !kind;
  if (!kind) return;
  $('instTitle').textContent = kind === 'piano' ? 'Keyboard' : 'Guitar';
  $('pianoKeys').hidden = kind !== 'piano'; $('guitarChords').hidden = kind !== 'guitar';
  showOctave();
}
function showOctave() {
  keyHints($('instHint'), use.inst === 'piano' ? [['Z X', `octave C${4 + use.octave}`], ['Esc', 'get up']] : [['1–8', 'strum'], ['Shift', 'strum up'], ['Esc', 'get up']]);
}
function playKey(code, on) {
  const el = document.querySelector(`[data-code="${code}"]`);
  if (on) { if (use.held.has(code)) return; use.held.set(code, pianoNote(60 + 12 * use.octave + PIANO[code])); }
  else { use.held.get(code)?.(); use.held.delete(code); }
  el?.classList.toggle('on', on);
}
function playChord(i, up) {
  strum(i, up);
  const el = $('guitarChords').children[i]; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 160);
}
function getUp() { const p = player.person; if (player.sitting && p) { standUp(p); updatePrompts(); } }
// While drawing or playing, the keys belong to the board or the instrument (before anything else sees them).
function onKey(e) {
  if ((!use.board && !use.inst) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const down = e.type === 'keydown';
  if (e.key === 'Escape') { e.stopPropagation(); if (down) { if (use.board) endBoard(); else getUp(); } return; }
  if (use.board && WALK.has(e.code)) return; // step closer or back while drawing
  if (e.key.length !== 1 && !e.key.startsWith('Arrow')) return; // Shift, Tab, F-keys...
  e.preventDefault(); e.stopPropagation();
  if (!use.inst || e.repeat) return;
  if (use.inst === 'guitar') { const m = /^Digit([1-8])$/.exec(e.code); if (m && down) playChord(+m[1] - 1, e.shiftKey); return; }
  if (down && (e.code === 'KeyZ' || e.code === 'KeyX')) { use.octave = Math.max(-2, Math.min(2, use.octave + (e.code === 'KeyX' ? 1 : -1))); showOctave(); }
  else if (e.code in PIANO) playKey(e.code, down);
}

// Per frame: the instrument you sit at, the board you left, and what you aim at (a few times a second).
function updateInteract(dt) {
  const sp = ctl.active ? player.sitting : null, inst = sp?.kind === 'piano' || sp?.kind === 'guitar' ? sp.kind : null;
  if (inst !== use.inst) setInstrument(inst);
  if (use.board && (!ctl.active || player.person?.state !== 'player')) endBoard(); // left walking, or a fight came up
  else if (use.board && ctl.mode === 'tp') boardCamera();
  use.aimAcc += dt; if (use.aimAcc > .15) { use.aimAcc = 0; aimAt(); }
  const a = player.aim, text = a ? aimText(a) : '';
  const b = $('fpUse');
  if (b.hidden !== !text) b.hidden = !text;
  if (text) keyed(b, ctl.coarse ? null : 'E', text);
}

// The on-screen keyboard (click or tap it too) and the chord buttons.
function buildInstruments() {
  const keysEl = $('pianoKeys'), whites = Object.keys(PIANO).filter(c => ![1, 3, 6, 8, 10, 13, 15].includes(PIANO[c]));
  const key = (code, cls) => {
    const k = document.createElement('div'), label = document.createElement('kbd'); k.className = cls; k.dataset.code = code;
    label.textContent = KEY_LABEL[code] ?? code.slice(3); k.append(label);
    k.addEventListener('pointerdown', e => { e.preventDefault(); playKey(code, true); });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) k.addEventListener(t, () => playKey(code, false));
    return k;
  };
  keysEl.append(...whites.map(c => key(c, 'wk')));
  for (const [code, semi] of Object.entries(PIANO)) {
    if (whites.includes(code)) continue;
    const k = key(code, 'bk'); k.style.left = `${(whites.findIndex(c => PIANO[c] > semi)) / whites.length * 100}%`; keysEl.append(k);
  }
  $('guitarChords').append(...CHORDS.map(([name], i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn chord';
    const n = document.createElement('b'), k = document.createElement('kbd'); n.textContent = name; k.textContent = String(i + 1);
    b.append(n, k); b.onclick = () => playChord(i, false); return b;
  }));
}

function initInteract() {
  ctl.useHook = useAim;
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) renderer.domElement.addEventListener(t, boardPointer, { capture: true });
  renderer.domElement.addEventListener('wheel', boardZoom, { capture: true, passive: false });
  keyHints($('boardHint'), [['WASD', 'step'], ['Wheel', 'zoom']]);
  addEventListener('keydown', onKey, { capture: true }); addEventListener('keyup', onKey, { capture: true });
  addEventListener('blur', () => { for (const code of [...use.held.keys()]) playKey(code, false); });
  $('fpUse').onclick = useAim;
  document.querySelectorAll('[data-pen]').forEach(b => b.onclick = () => pickPen(+b.dataset.pen));
  $('boardClear').onclick = () => { if (use.board) clearBoard(use.board); };
  $('boardDone').onclick = endBoard;
  buildInstruments();
}

export { initInteract, updateInteract };
