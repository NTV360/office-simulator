import * as THREE from 'three';
import { M } from '../render/materials.js';
import { boxGeo } from '../world/helpers.js';
import { sph, stdMat } from './gfx.js';

// Props that a character holds. Shared by the rig (carried) and the world (the guitar on its stand).
function makeGuitar() {
  const g = new THREE.Group();
  const bodyM = M.guitarBody, darkM = M.chairBase;
  const lower = new THREE.Mesh(new THREE.SphereGeometry(.19, 18, 12), bodyM); lower.scale.set(1, .85, .28); lower.position.x = -.06; lower.castShadow = true; g.add(lower);
  const upper = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 10), bodyM); upper.scale.set(1, .85, .28); upper.position.x = .15; upper.castShadow = true; g.add(upper);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(.05, 16), darkM); hole.position.set(.06, 0, .056); g.add(hole);
  const bridge = new THREE.Mesh(boxGeo(.03, .1, .015), darkM); bridge.position.set(-.1, 0, .055); g.add(bridge);
  const neck = new THREE.Mesh(boxGeo(.46, .05, .025), M.diningWood2); neck.position.set(.5, 0, .03); g.add(neck);
  const headstock = new THREE.Mesh(boxGeo(.14, .07, .02), darkM); headstock.position.set(.79, 0, .03); g.add(headstock);
  return g;
}

// The green toilet bucket: on the floor by the counter, or carried by whoever is "deploying to the toilet".
// Its origin is the bottom centre.
function makeBucket() {
  const g = new THREE.Group(), green = stdMat('#2f9e57', .55), dark = stdMat('#23774a', .6);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.15, .12, .3, 18, 1, true), green); body.material.side = THREE.DoubleSide; body.position.y = .15; body.castShadow = true; g.add(body);
  const base = new THREE.Mesh(new THREE.CircleGeometry(.12, 18), dark); base.rotation.x = -Math.PI / 2; base.position.y = .005; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.15, .012, 6, 24), dark); rim.rotation.x = Math.PI / 2; rim.position.y = .3; g.add(rim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.15, .007, 6, 20, Math.PI), stdMat('#c6ced4', .3)); handle.position.y = .3; g.add(handle);
  return g;
}

// The props activities put in the right hand: a mug, a phone, a game pad, a putter and the bucket. Positions are
// offsets in metres from the hand; the rig attaches them. All start hidden.
function makeHeldProps() {
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(.04, .035, .09, 12), stdMat('#ffffff', .4)); mug.position.set(0, -.05, .05);
  const phone = new THREE.Mesh(boxGeo(.045, .1, .012), stdMat('#15191d', .3)); phone.position.set(0, -.04, .04);
  const putter = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .62, 6), stdMat('#c6ced4', .3)); shaft.position.y = -.33; putter.add(shaft);
  const pgrip = new THREE.Mesh(new THREE.CylinderGeometry(.015, .013, .14, 8), stdMat('#22272c', .6)); pgrip.position.y = -.06; putter.add(pgrip);
  const phead = new THREE.Mesh(boxGeo(.11, .03, .04), stdMat('#2a3036', .4)); phead.position.set(.035, -.64, 0); putter.add(phead);
  putter.position.set(0, -.02, .02);
  const pad = new THREE.Group(); const pw = stdMat('#eef0f2', .4), pk = stdMat('#22272c', .4);
  pad.add(new THREE.Mesh(boxGeo(.15, .028, .07), pw));
  [-1, 1].forEach(sd => { const gp = new THREE.Mesh(sph(.03, 8, 6), pw); gp.position.set(sd * .066, -.006, -.03); gp.scale.set(1, .8, 1.5); pad.add(gp); });
  const tp = new THREE.Mesh(boxGeo(.065, .006, .035), pk); tp.position.set(0, .016, .005); pad.add(tp);
  pad.position.set(.08, -.07, .05);
  const bucket = makeBucket(); bucket.position.set(0, -.32, .02); // hangs from the hand by its handle
  const held = { mug, phone, pad, putter, bucket };
  for (const p of Object.values(held)) p.visible = false;
  return held;
}

export { makeBucket, makeGuitar, makeHeldProps };
