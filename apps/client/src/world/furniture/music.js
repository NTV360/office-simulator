import * as THREE from 'three';
import { interactables, isDriven } from '@office/shared';
import { makeGuitar } from '../../character/props.js';
import { M, canvasTex } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, WST, mkSpot } from './basics.js';
import { box, boxGeo, cyl, rectPlane } from '../helpers.js';
import { placeLater, placeObject } from '../objects.js';
import { attachToObject } from '../../render/objects.js';

// Music corner by the east window: keyboard piano and an acoustic guitar anyone can play
const MUSIC = { notes: [], standGuitar: null };

// The stand, the keyboard and the stools are items (shared/world/catalogue.ts), drawn from these. The stand and the keyboard stand where the
// stand's footprint is: 2 cm from where they used to be drawn, so their parts are 2 cm (.0205 m) the other way in their own frame.
const Z = .0205;
function drawPianoStand(k) {
  [[-.45, .4], [.45, -.4]].forEach(([x, r]) => { [-1, 1].forEach(sd => { const leg = new THREE.Mesh(boxGeo(.03, .9, .03), M.chairBase); leg.position.set(x * .9, .42, Z); leg.rotation.x = r * sd; leg.castShadow = true; k.add(leg); }); });
  box(k, 1.3, .03, .3, M.chairBase, 0, .78, Z);
}
function drawPiano(k) {
    box(k, 1.28, .09, .34, M.keyboardBody, 0, .045, Z);
    const keysTex = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9aa0a6'; g.lineWidth = 1;
      const n = 36, kw = w / n; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * kw, 0); g.lineTo(i * kw, h); g.stroke(); }
      g.fillStyle = '#15191d'; for (let i = 0; i < n; i++) { const m = i % 7; if (m === 2 || m === 6) continue; g.fillRect((i + 1) * kw - kw * .3, 0, kw * .6, h * .62); }
    });
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.18, .15), new THREE.MeshStandardMaterial({ map: keysTex, roughness: .5 }));
    keys.rotation.x = -Math.PI / 2; keys.position.set(0, .091, .09 + Z); k.add(keys);
    box(k, .3, .02, .06, M.monitor, -.4, .095, -.08 + Z, false);
}
/** A low stool: the piano's (variant 0) or the guitar's, a little smaller (1). */
function drawStoolLow(s, small) {
  const r = small ? .18 : .19;
  cyl(s, r, r, .06, M.chairSeat2, 0, .52, 0, 16); cyl(s, .03, .03, .5, M.steel, 0, .25, 0, 8); cyl(s, r + .01, r + .01, .02, M.chairBase, 0, .01, 0, 14);
}
const drawGuitarStand = gs => { box(gs, .3, .02, .25, M.chairBase, 0, .01, 0); box(gs, .03, .55, .03, M.chairBase, 0, .3, -.06); };

function buildMusic() {
    rectPlane(630, 503, 679, 572, M.musicRug, .006);
    // keyboard on an X stand, player faces the window
    const ky = 525;
    placeLater(() => placeObject('piano-stand', 668.5, ky, WST));
    placeLater(() => placeObject('piano', 668.5, ky, WST, { y: .795 }));
    const piano = mkSpot('piano', 652, ky, E, { sit: true, hipY: .6, place: 'the keyboard', group: 'music' });
    placeLater(() => placeObject('stool-low', 652, ky, E, { spot: piano.id })); // (round: it faces the way its seat does)
    // guitar stand + stool (the guitar on the stand is the one a player picks up: it is hidden while it is played)
    const sg = makeGuitar(); sg.rotation.set(.12, Math.PI / 2, Math.PI / 2 - .05); sg.position.set(0, .45, .02); MUSIC.standGuitar = sg;
    placeLater(() => placeObject('guitar-stand', 672, 556, WST), o => attachToObject(o, sg));
    const guitar = mkSpot('guitar', 648, 556, WST, { sit: true, hipY: .6, place: 'the guitar', group: 'music' });
    placeLater(() => placeObject('stool-low', 648, 556, WST, { variant: 1, spot: guitar.id }));
    // floating music notes
    const noteTex = canvasTex(64, 64, (g) => { g.fillStyle = '#2f3a45'; g.font = 'bold 48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 32, 34); });
    for (let i = 0; i < 6; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false })); sp.scale.setScalar(.22); sp.visible = false; scene.add(sp); MUSIC.notes.push({ sp, seat: interactables.of('music')[i % 2], off: i * .7 }); }
}

function updateMusic(now) {
  const gp = interactables.of('guitar')[0].occupant; MUSIC.standGuitar.visible = !gp;
  for (const n of MUSIC.notes) {
    const p = n.seat.occupant, playing = p && (p.state === 'doing' || isDriven(p));
    if (!playing) { n.sp.visible = false; continue; }
    const t = ((now / 1000 + n.off) % 2.1) / 2.1;
    n.sp.visible = true; n.sp.material.opacity = Math.sin(t * Math.PI);
    n.sp.position.set(n.seat.pos.x + Math.sin(t * 6 + n.off) * .2, 1.3 + t * .9, n.seat.pos.z + Math.cos(t * 5 + n.off) * .15);
  }
}

export { buildMusic, drawGuitarStand, drawPiano, drawPianoStand, drawStoolLow, updateMusic };
