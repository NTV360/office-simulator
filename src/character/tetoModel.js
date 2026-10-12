import * as THREE from 'three';

/* Kasane Teto's 3D model: "Kasane Teto SynthV" by Jomomonogm (BowlRoll, Animasa style), design Sakauchi Waka,
   copyright TWINDRILL; used within the TWINDRILL / AH-Software character guidelines. Files: public/models/lim/teto/ */
const TETO_MODEL_URL = 'models/lim/teto/' + encodeURIComponent('Kasane Teto SynthV') + '/' + encodeURIComponent('Kasane Teto SV_TEX.pmx');
const K = .88 / 11.25; // MMD units -> metres, matching her thigh joint (11.25 units up) to the rig's hip height
const BONES = { center: 'センター', upper: '上半身', head: '頭', lArm: '左腕', rArm: '右腕', lEl: '左ひじ', rEl: '右ひじ', lLeg: '左足', rLeg: '右足', lKnee: '左ひざ', rKnee: '右ひざ', lWrist: '左手首', rWrist: '右手首' };
// Office chair her skirt rests on, in metres around her hips: half width, front edge, backrest.
const CHAIR = { halfW: .24, front: .25, back: -.19 };
const GRIP_SPREAD = -.1; // holding the controller her wrists end up ~14 cm apart, its width (measured on the gaming pose)
// On sofas and armchairs her arms, wider and longer than the rig's, would hang into the armrests: there her
// resting hands go onto her lap instead (shoulder forward, arm in, elbow bent). Raised arms are left alone.
const LAP = { shX: -.5, inward: .3, el: -1.1 };
// A hand brought up to her head (a phone call, a sip) would land on her face: her arms are longer for her
// shoulders than the rig's. With the elbow folded past FOLD the upper arm is raised further, out and forward,
// which puts the hand by her ear (measured: within a few cm of her ear for the phone pose).
const FOLD = -2, FOLD_OUT = .8, FOLD_UP = -.6;

let loading = null, source = null, cloneSkinned = null;

// Load the PMX once. The file was made on Windows: it asks for "Tex\Body.png" but the files are lowercase,
// which matters on a case-sensitive server. The loader is fetched on demand to keep it out of the main bundle.
// Each call gets its own copy of the model (sharing geometry and textures), so NPC Teto and a player playing
// as her can both have one.
function loadTetoModel() {
  if (!loading) loading = Promise.all([import('three/addons/loaders/MMDLoader.js'), import('three/addons/utils/SkeletonUtils.js')]).then(([{ MMDLoader }, su]) => new Promise((res, rej) => {
    cloneSkinned = su.clone;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(u => u.replace(/[\\/]Tex[\\/]([^\\/?#]+)$/, (_, f) => '/Tex/' + f.toLowerCase()));
    new MMDLoader(manager).load(import.meta.env.BASE_URL + TETO_MODEL_URL, m => { source = m; res(); }, undefined, rej);
  }));
  return loading.then(() => cloneSkinned(source));
}

// Put the model on a rig: the rig's own meshes are hidden (they stay as an invisible, clickable skeleton),
// the held props move onto her bones, and her glasses/headphones are fitted to her head.
// Returns the state driveTetoModel needs.
// Where each held prop sits on her (metres, in the holder's frame): the rig places them in its own units.
const PROP_AT = { mug: [0, -.05, .05], phone: [0, -.04, .04], putter: [0, -.02, .02], bucket: [0, -.32, .02], guitar: [-.04, .14, .2] };
function fitTetoModel(mesh, body) {
  const props = [body.mug, body.phone, body.pad, body.putter, body.bucket, body.guitar];
  const keep = new Set(); props.forEach(o => o.traverse(c => keep.add(c)));
  body.root.traverse(o => { if (o.isMesh && !keep.has(o)) o.visible = false; });
  mesh.scale.setScalar(K); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  body.root.add(mesh);
  const bones = {}; for (const [k, n] of Object.entries(BONES)) bones[k] = mesh.skeleton.bones.find(x => x.name === n);
  // hand-held props ride on her right wrist, the guitar on her upper body (holders undo the model's scale)
  const holder = bone => { const h = new THREE.Group(); h.scale.setScalar(1 / K); bone.add(h); return h; };
  const hand = holder(bones.rWrist), chest = holder(bones.upper);
  for (const k of ['mug', 'phone', 'putter', 'bucket', 'guitar']) {
    const o = body[k]; (k === 'guitar' ? chest : hand).add(o);
    o.position.set(...PROP_AT[k]); o.rotation.set(0, 0, k === 'guitar' ? .35 : 0); o.scale.setScalar(k === 'guitar' ? .95 : 1);
  }
  // the controller is held in both hands: it is placed between her wrists every frame
  const grip = new THREE.Group(); grip.scale.setScalar(1 / K); mesh.add(grip); grip.add(body.pad);
  body.pad.position.set(0, 0, 0); body.pad.rotation.set(0, 0, 0); body.pad.scale.setScalar(1);
  addWearables(mesh, bones.head);
  // her arms are modelled angled down (an A-pose), so an elbow bends about the axis across its own forearm
  // (forearm × forward), not about straight up/down; with the wrong axis a full bend swings the hand sideways
  const restPos = b => { const v = new THREE.Vector3(); for (; b && b.isBone; b = b.parent) v.add(b.position); return v; };
  const elAxis = [[bones.lEl, bones.lWrist], [bones.rEl, bones.rWrist]].map(([e, w]) => restPos(w).sub(restPos(e)).cross(AX_Z).normalize());
  return { mesh, bones, holders: [hand, chest, grip], grip, pad: body.pad, elAxis, skirt: makeSkirt(mesh), centerY: bones.center.position.y, K, clone: cloneSkinned };
}

// Drive the model's bones from the rig's pose (same conventions: +z forward, angles in radians).
const qx = new THREE.Quaternion(), qz = new THREE.Quaternion(), AX_X = new THREE.Vector3(1, 0, 0), AX_Z = new THREE.Vector3(0, 0, 1);
const seat = { top: 0, halfW: CHAIR.halfW / K, front: CHAIR.front / K, back: CHAIR.back / K, cushion: false }, wl = new THREE.Vector3(), wr = new THREE.Vector3(), toLocal = new THREE.Matrix4();
// `spot` is what she's sitting on, if anything.
function driveTetoModel(m, c, spot) {
  const spread = m.pad.visible ? GRIP_SPREAD : 0, lap = spot?.kind === 'lounge' && c.hipY < .75;
  let lShX = c.lShX, rShX = c.rShX, lShZ = c.lShZ + spread, rShZ = c.rShZ - spread, lEl = c.lEl, rEl = c.rEl;
  if (lap && lShX > LAP.shX) { lShX = LAP.shX; lShZ -= LAP.inward; lEl = Math.min(lEl, LAP.el); }
  if (lap && rShX > LAP.shX) { rShX = LAP.shX; rShZ += LAP.inward; rEl = Math.min(rEl, LAP.el); }
  if (lEl < FOLD) { const k = Math.min(1, (FOLD - lEl) / .4); lShZ += FOLD_OUT * k; lShX += FOLD_UP * k; }
  if (rEl < FOLD) { const k = Math.min(1, (FOLD - rEl) / .4); rShZ -= FOLD_OUT * k; rShX += FOLD_UP * k; }
  const B = m.bones;
  B.center.position.y = m.centerY + (c.hipY - .88) / K;
  B.upper.rotation.set(c.lean, 0, 0);
  B.head.rotation.set(c.headX, c.headY, 0);
  B.lArm.quaternion.copy(qx.setFromAxisAngle(AX_X, lShX)).multiply(qz.setFromAxisAngle(AX_Z, -.55 + lShZ));
  B.rArm.quaternion.copy(qx.setFromAxisAngle(AX_X, rShX)).multiply(qz.setFromAxisAngle(AX_Z, .55 + rShZ));
  B.lEl.quaternion.setFromAxisAngle(m.elAxis[0], -lEl); B.rEl.quaternion.setFromAxisAngle(m.elAxis[1], -rEl);
  B.lLeg.rotation.set(c.lHip, 0, 0); B.rLeg.rotation.set(c.rHip, 0, 0);
  B.lKnee.rotation.set(c.lKnee, 0, 0); B.rKnee.rotation.set(c.rKnee, 0, 0);
  const sitting = c.hipY < .75 && (c.lHip + c.rHip) / 2 < -.9;
  // sofas and armchairs are deep, soft boxes that hide anything sinking into them, so there the skirt is not
  // lifted off the seat (doing so made it stick out through the armrests)
  seat.top = (c.hipY - .04) / K; seat.cushion = spot?.kind === 'lounge';
  m.skirt(sitting ? seat : null); // also brings the bones' world matrices up to date
  if (m.pad.visible) {
    toLocal.copy(m.mesh.matrixWorld).invert();
    wl.setFromMatrixPosition(B.lWrist.matrixWorld).applyMatrix4(toLocal); wr.setFromMatrixPosition(B.rWrist.matrixWorld).applyMatrix4(toLocal);
    m.grip.position.addVectors(wl, wr).multiplyScalar(.5); m.grip.position.z += .5; // just ahead of her wrists, in her hands
    m.grip.rotation.set(-.35, 0, 0); // tilted up toward her
  }
}

// Headphones and glasses, built to her head's measured proportions (model units, rest pose):
// eyes centred x ±.58 at y 17.75 (front z .84, face skin z 1.08); ears x .79–1.39 at y 17.2–18.0; hair half-width
// 1.48 at y 18.6, 1.39 at 19.2, 1.16 at 19.6, crown ~20.5; side locks to x 1.53; drills and bows behind z -.29
const WEAR = { headphones: '#2b3138', glasses: true }; // her own look: dark headphones with red cups, thin dark glasses
function addWearables(mesh, head) {
  let hx = 0, hy = 0, hz = 0; for (let b = head; b && b.isBone; b = b.parent) { hx += b.position.x; hy += b.position.y; hz += b.position.z; }
  const at = (o, x, y, z) => { o.position.set(x - hx, y - hy, z - hz); head.add(o); return o; }; // place in model coords
  const mat = (c, r = .5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  if (WEAR.headphones) {
    const dark = mat(WEAR.headphones, .45), accent = mat('#c8203a', .5), pad = mat('#1a1d21', .9);
    const CY = 17.6, AX = 1.75, BY = 2.6; // band: half an ellipse from cup to cup, just clear of the hair
    const pts = []; for (let i = 0; i <= 40; i++) { const a = Math.PI * i / 40; pts.push(new THREE.Vector3(Math.cos(a) * AX, CY + .35 + Math.sin(a) * (BY - .35), .05)); }
    at(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .1, 10), dark), 0, 0, 0); // points are already in model coords
    at(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice(8, 33)), 30, .13, 10), pad), 0, -.1, 0); // padding under the top
    for (const sd of [1, -1]) {
      const EX = 1.39 + .13, EZ = -.1; // cups pressed onto her ears (ear outer edge x 1.39, centre z -.1)
      const cup = new THREE.Group(); at(cup, sd * EX, CY, EZ); cup.rotation.z = Math.PI / 2;
      cup.add(new THREE.Mesh(new THREE.CylinderGeometry(.44, .44, .3, 24), dark));
      cup.add(new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .32, 24), accent));
      const ear = new THREE.Mesh(new THREE.TorusGeometry(.33, .08, 10, 24), pad); ear.rotation.x = Math.PI / 2; ear.position.y = sd * -.15; cup.add(ear);
      // arm from the band's end down to the cup
      const top = new THREE.Vector3(sd * AX, CY + .5, .05), bot = new THREE.Vector3(sd * EX, CY + .3, EZ), len = top.distanceTo(bot);
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(.08, len + .1, .16), dark); at(yoke, (top.x + bot.x) / 2, (top.y + bot.y) / 2, (top.z + bot.z) / 2);
      yoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    }
  }
  if (WEAR.glasses) {
    const frame = mat('#20262b', .4, .3), lens = new THREE.MeshStandardMaterial({ color: 0xd8e6f0, roughness: .05, transparent: true, opacity: .22, depthWrite: false });
    // close to the face and angled to follow its curve (face front: z 1.08 at the nose, 1.01 at the lens' inner
    // edge, .88 at the outer edge; lashes to .97), arms from the outer corners back to the ears
    const W = .6, H = .5, Y = 17.76, R = .1, Z = 1.03, WRAP = .21;
    const rr = (w, h, r) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return sh; };
    for (const sd of [1, -1]) {
      const side = new THREE.Group(); at(side, sd * .58, Y, Z); side.rotation.y = sd * WRAP;
      const outline = rr(W, H, R); outline.holes.push(rr(W - .09, H - .09, R * .6));
      side.add(new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: .04, bevelEnabled: false }), frame));
      const l = new THREE.Mesh(new THREE.ShapeGeometry(rr(W - .09, H - .09, R * .6)), lens); l.position.z = .02; l.renderOrder = 3; side.add(l);
      const a = new THREE.Vector3(sd * (.58 + W / 2 * Math.cos(WRAP)), Y + .12, Z - W / 2 * Math.sin(WRAP)), b = new THREE.Vector3(sd * 1.33, Y + .12, 0);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(.04, .05, a.distanceTo(b)), frame);
      at(temple, (a.x + b.x) / 2, a.y, (a.z + b.z) / 2);
      temple.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.clone().sub(b).normalize());
    }
    // bridge: spans between the lenses' inner edges (x ±.29 once angled), just in front of the nose
    const inX = .58 - W / 2 * Math.cos(WRAP), inZ = Z + W / 2 * Math.sin(WRAP) + .02;
    at(new THREE.Mesh(new THREE.BoxGeometry(2 * inX + .06, .05, .04), frame), 0, Y + .1, Math.max(1.12, inZ));
  }
  head.traverse(o => { if (o.isMesh && o !== mesh) { o.castShadow = true; o.frustumCulled = false; } });
}

// Skirt: the model has no physics running here, so each skirt strip hangs by gravity and only bends where it
// would pass through her legs or the chair. Seated, it sits the way a skirt does on a chair: the front lies over
// her lap, the sides and back are sat on (tucked forward under her, not spread out), and the back is let out a
// little so it covers her bottom down to the seat. Nothing pokes out under the seat. Walking, it gives way to each
// leg. Worked out in the model's own space (MMD units).
const RT = .82, RS = .6, MARGIN = .2; // thigh / shin radius incl. the skirt's own thickness; clearance off the chair
const TUCK = .5, BACK = -.3, INWARD = .4, BACK_LEN = 1.3; // which strips are sat on / at her bottom; side tuck-in; back let-out
function makeSkirt(mesh) {
  const bones = mesh.skeleton.bones, byName = n => bones.find(b => b.name === n);
  const chains = {}; for (const b of bones) { const mm = b.name.match(/^スカート_(\d+)_(\d+)$/); if (mm) (chains[mm[2]] ||= [])[+mm[1]] = b; }
  const legs = [['左足', '左ひざ', '左足首'], ['右足', '右ひざ', '右足首']].map(n => n.map(byName));
  const v = new THREE.Vector3(), tmp = new THREE.Vector3(), inv = new THREE.Matrix4(), P = new THREE.Vector3(), C = new THREE.Vector3();
  const Hp = [new THREE.Vector3(), new THREE.Vector3()], Kn = [new THREE.Vector3(), new THREE.Vector3()], An = [new THREE.Vector3(), new THREE.Vector3()];
  const Hm = new THREE.Vector3(), Km = new THREE.Vector3();
  const O = new THREE.Quaternion(), Ok = new THREE.Quaternion(), Oi = new THREE.Quaternion(), Qin = new THREE.Quaternion(), FWD = new THREE.Vector3(-1, 0, 0);
  const local = (bone, out) => out.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv);
  const segDist = (p, a, b) => { const ab = tmp.subVectors(b, a); const t = Math.max(0, Math.min(1, ab.dot(v.subVectors(p, a)) / ab.lengthSq())); return p.distanceTo(v.copy(a).addScaledVector(ab, t)); };
  const list = Object.values(chains).map(ch => {
    const p = ch[0].position, d = Math.hypot(p.x, p.z) || 1;
    for (let k = 1; k < ch.length; k++) ch[k].userData.rest = ch[k].position.clone();
    return { ch, out: new THREE.Vector3(-p.z / d, 0, p.x / d), dz: p.z / d };
  });
  let seat = null;
  const inSeat = p => p.y < seat.top + MARGIN && Math.abs(p.x) < seat.halfW + MARGIN && p.z < seat.front + MARGIN && p.z > seat.back - 1.2;
  const inBack = p => p.z < seat.back - .3 && p.y < seat.top + 9;
  const inLegs = p => (seat && segDist(p, Hm, Km) < RT * 1.15) || // seated: the lap between the thighs too
    segDist(p, Hp[0], Kn[0]) < RT || segDist(p, Hp[1], Kn[1]) < RT || segDist(p, Kn[0], An[0]) < RS || segDist(p, Kn[1], An[1]) < RS;
  return s => {
    seat = s;
    mesh.updateMatrixWorld(true); inv.copy(mesh.matrixWorld).invert();
    for (let i = 0; i < 2; i++) { local(legs[i][0], Hp[i]); local(legs[i][1], Kn[i]); local(legs[i][2], An[i]); }
    Hm.addVectors(Hp[0], Hp[1]).multiplyScalar(.5); Km.addVectors(Kn[0], Kn[1]).multiplyScalar(.5);
    for (const { ch, out, dz } of list) {
      const tuck = seat && dz < TUCK, back = seat && dz < BACK, axis = tuck ? FWD : out;
      Qin.setFromAxisAngle(out, tuck && !back ? -INWARD : 0); // sides: pulled in against her hips
      for (let k = 1; k < ch.length; k++) ch[k].position.copy(ch[k].userData.rest).multiplyScalar(back ? BACK_LEN : 1);
      local(ch[0], P); O.identity();
      for (let k = 0; k < ch.length; k++) {
        const child = ch[k + 1]; if (tuck) Ok.copy(Qin); else Ok.identity(); // start hanging straight down
        if (child) {
          for (let th = 0, n = 0; n < 56; n++, th += .05) { // smallest swing that clears legs and chair
            Ok.setFromAxisAngle(axis, th); if (tuck) Ok.multiply(Qin);
            C.copy(child.position).applyQuaternion(Ok).add(P);
            if (!(seat && !seat.cushion && (inSeat(C) || inBack(C))) && (back || !inLegs(C))) break; // sides wrap over the thighs, only the back goes under her
          }
        }
        ch[k].quaternion.copy(Oi.copy(O).invert().multiply(Ok)); O.copy(Ok); if (child) P.copy(C);
      }
    }
  };
}

export { driveTetoModel, fitTetoModel, loadTetoModel };
