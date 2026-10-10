import * as THREE from 'three';
import { interactables, isDriven } from '@office/shared';
import { makeGuitar } from '../../character/props.js';
import { M, canvasTex } from '../../render/materials.js';
import { scene } from '../../render/renderer.js';
import { E, WST, mkSpot } from './basics.js';
import { addObs, box, boxGeo, cyl, frame, rectPlane } from '../helpers.js';

// Music corner by the east window: keyboard piano and an acoustic guitar anyone can play
const MUSIC = { notes: [], standGuitar: null };

function buildMusic() {
    rectPlane(630, 503, 679, 572, M.musicRug, .006);
    // keyboard on an X stand, player faces the window
    const kx = 668, ky = 525; addObs(663, 507, 674, 543);
    const k = frame(kx, ky, WST);
    [[-.45, .4], [.45, -.4]].forEach(([x, r]) => { [-1, 1].forEach(sd => { const leg = new THREE.Mesh(boxGeo(.03, .9, .03), M.chairBase); leg.position.set(x * .9 + sd * .0, .42, 0); leg.rotation.x = r * sd; leg.castShadow = true; k.add(leg); }); });
    box(k, 1.3, .03, .3, M.chairBase, 0, .78, 0);
    box(k, 1.28, .09, .34, M.keyboardBody, 0, .84, 0);
    const keysTex = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9aa0a6'; g.lineWidth = 1;
      const n = 36, kw = w / n; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * kw, 0); g.lineTo(i * kw, h); g.stroke(); }
      g.fillStyle = '#15191d'; for (let i = 0; i < n; i++) { const m = i % 7; if (m === 2 || m === 6) continue; g.fillRect((i + 1) * kw - kw * .3, 0, kw * .6, h * .62); }
    });
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.18, .15), new THREE.MeshStandardMaterial({ map: keysTex, roughness: .5 }));
    keys.rotation.x = -Math.PI / 2; keys.position.set(0, .886, .09); k.add(keys);
    box(k, .3, .02, .06, M.monitor, -.4, .89, -.08, false);
    const stool = frame(652, ky, WST); cyl(stool, .19, .19, .06, M.chairSeat2, 0, .52, 0, 16); cyl(stool, .03, .03, .5, M.steel, 0, .25, 0, 8); cyl(stool, .2, .2, .02, M.chairBase, 0, .01, 0, 14);
    mkSpot('piano', 652, ky, E, { sit: true, hipY: .6, place: 'the keyboard', group: 'music' });
    // guitar stand + stool
    const gs = frame(672, 556, WST);
    box(gs, .3, .02, .25, M.chairBase, 0, .01, 0); box(gs, .03, .55, .03, M.chairBase, 0, .3, -.06);
    const sg = makeGuitar(); sg.rotation.set(.12, Math.PI / 2, Math.PI / 2 - .05); sg.position.set(0, .45, .02); gs.add(sg); MUSIC.standGuitar = sg; sg.traverse(o => o.userData.dynamic = true);
    addObs(667, 550, 677, 562);
    const gstool = frame(648, 556, WST); cyl(gstool, .18, .18, .06, M.chairSeat2, 0, .52, 0, 16); cyl(gstool, .03, .03, .5, M.steel, 0, .25, 0, 8); cyl(gstool, .19, .19, .02, M.chairBase, 0, .01, 0, 14);
    mkSpot('guitar', 648, 556, WST, { sit: true, hipY: .6, place: 'the guitar', group: 'music' });
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

export { buildMusic, updateMusic };
