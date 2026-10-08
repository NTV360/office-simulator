import * as THREE from 'three';
import { follow } from '../camera/controller.js';
import { camGoal } from '../camera/state.js';
import { exitPlay } from '../player/control.js';
import { canvasTex } from '../render/materials.js';
import { camera, scene } from '../render/renderer.js';
import { addLog, people } from '../sim/state.js';
import { $ } from '../ui/dom.js';
import { fmt, select } from '../ui/person.js';

// Hazel Sellote: the one hand-written character. She is the first person created (see makePerson),
// has her own look, always leaves last, and can be found or made angry from the HUD.
const HAZEL_NAME = 'Hazel Sellote';

// Give the first generated person Hazel's identity. Mutates the spec; returns her name and role.
function applyHazel(spec) {
  Object.assign(spec, { style: 'bob', cube: true, hair: '#2b201b', scale: .7, skirt: '#2f3d6b', angry: true, glasses: false, headphones: null, jacket: null, shirt: '#9b4d62', pants: '#2a2228', skin: '#d9a27a' });
  return { first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer' };
}

// ----- rage mode: for 10 seconds she swells, turns red, steams, and stomps -----
const HAZEL = () => people.find(q => q.name === 'Hazel Sellote');
const RAGE = { on: false, until: 0, t: 0, puffs: [], skinMat: new THREE.MeshStandardMaterial({ color: 0xd8432e, emissive: 0x8a1a0a, emissiveIntensity: .55, roughness: .55 }) };

// Create the steam sprites and hook up the HUD buttons.
function initHazel() {
    const puffTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    for (let i = 0; i < 8; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false })); sp.visible = false; scene.add(sp); RAGE.puffs.push({ sp, off: i / 8, side: i % 2 ? 1 : -1 }); }
  $('findHazel').onclick = findHazel;
  $('rageHazel').onclick = startRage;
}

function findHazel() {
  const h = HAZEL(); if (!h) return;
  exitPlay();
  select(h);
  if (h.state === 'away') { addLog(h.arrivedAt ? 'Hazel has already gone home' : `Hazel isn't in yet, due around ${fmt(h.arriveAt)}`); return; }
  follow(h);
  camGoal.dist = 7; camGoal.pitch = .7; camGoal.yaw = h.face + Math.PI + .5;
}

function startRage() {
  const h = HAZEL(); if (!h) return;
  select(h);
  if (h.state === 'away') { addLog(h.arrivedAt ? 'Hazel has gone home. She can stay angry tomorrow.' : `Hazel isn't in yet, due around ${fmt(h.arriveAt)}`); return; }
  exitPlay();
  RAGE.on = true; RAGE.until = performance.now() + 10000; RAGE.t = 0;
  follow(h); camGoal.dist = 6.5; camGoal.pitch = .55; camGoal.yaw = h.face + .35;
  addLog('Hazel is FURIOUS');
}
function updateRage(dt, now) {
  const h = HAZEL(); if (!h) return;
  if (RAGE.on) { RAGE.t += dt; if (now >= RAGE.until || h.state === 'away') { RAGE.on = false; addLog('Hazel calmed down'); } }
  const tgt = RAGE.on ? 1 : 0; h.rageK = (h.rageK || 0) + (tgt - (h.rageK || 0)) * (1 - Math.exp(-dt * 5));
  const k = h.rageK, b = h.body;
  b.root.scale.setScalar(h.spec.scale * (1 + .14 * k));
  b.chest.scale.set(1.15 * (1 + .75 * k), 1 + .12 * k, .74 * (1 + .55 * k));
  [b.L, b.R].forEach((a, i) => { a.sh.scale.set(1 + .9 * k, 1 + .05 * k, 1 + .9 * k); a.sh.position.x = (i ? -1 : 1) * (.205 + .09 * k); });
  [b.LL, b.RL].forEach(l => l.hp.scale.set(1 + .45 * k, 1, 1 + .45 * k));
  const mat = k > .4 ? RAGE.skinMat : b.skin; b.skinMeshes.forEach(m => { if (m.material !== mat) m.material = mat; });
  RAGE.skinMat.emissiveIntensity = .4 + Math.sin(now * .012) * .2;
  // steam from the ears
  const show = k > .3 && h.state !== 'away';
  const head = new THREE.Vector3(); b.head.getWorldPosition(head);
  for (const p of RAGE.puffs) {
    if (!show) { p.sp.visible = false; continue; }
    const t = ((now / 900) + p.off) % 1, rgt = new THREE.Vector3(-Math.cos(h.face), 0, Math.sin(h.face)).multiplyScalar(p.side * (.16 + t * .25));
    p.sp.visible = true; p.sp.position.copy(head).add(rgt); p.sp.position.y += .12 + t * .55;
    p.sp.scale.setScalar(.12 + t * .35); p.sp.material.opacity = (1 - t) * .9 * k;
  }
  const btn = $('rageHazel');
  if (RAGE.on) { btn.disabled = true; btn.textContent = `Calming down… ${Math.ceil((RAGE.until - now) / 1000)}s`; }
  else if (btn.disabled) { btn.disabled = false; btn.textContent = 'Make her angry'; }
}

// Camera shake while she rages.
function rageShake(now) {
  if (RAGE.on && RAGE.t > .4) { const a = .035 * Math.min(1, (RAGE.until - now) / 1500); camera.position.x += (Math.random() - .5) * a; camera.position.y += (Math.random() - .5) * a; }
}

export { HAZEL, HAZEL_NAME, RAGE, applyHazel, initHazel, rageShake, updateRage };
