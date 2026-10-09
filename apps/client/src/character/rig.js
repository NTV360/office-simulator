import * as THREE from 'three';
import { CATS } from '@office/shared';
import { Character, STYLES } from './pack/characters.js';
import { mergeJoints } from './gfx.js';
import { addAngry } from './parts.js';
import { makeGuitar, makeHeldProps } from './props.js';

const ringGeo = new THREE.RingGeometry(.27, .33, 32);
const ringMats = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: .85, depthWrite: false })]));

// Pack sizes that make an average character about 1.45 m to the top of the head, in either style,
// so they fit the office furniture. (The pack's own default is about 1.05 m.)
const CHARACTER_SIZES = { chibi: { scale: .108 }, blocky: { px: .0447 } };
// The pack draws chibi heads about twice as wide as blocky ones (that is the chibi look). We shrink them,
// with their hair, hats and face, so both styles have the same head size (about 0.37 m across).
const CHIBI_HEAD = .4;
const HEAD_NODE = { chibi: 'HeadShape', blocky: 'Head' };
const box = new THREE.Box3(), v = new THREE.Vector3();

// Measure some meshes in world space (the character stands at the origin, facing +z, at rest).
function boundsOf(meshes) {
  box.makeEmpty(); for (const m of meshes) box.expandByObject(m);
  return box.clone();
}

// Which hands hold a pack item, and the arm pose the pack uses while carrying it.
function heldItems(character) {
  const lib = STYLES[character.type].lib, hold = { L: null, R: null };
  for (const a of character.inner.config.accessories) {
    const def = lib.ACCESSORIES[a.type]; if (def?.slot !== 'hand') continue;
    for (const side of def.hand === 'both' ? ['L', 'R'] : [a.side ?? def.hand]) hold[side] = { pose: def.pose ?? null, swing: def.swing ?? 1 };
  }
  return hold;
}

// Give a pack character our proportions. Call after every build or `set` (a set rebuilds the head).
function fitHead(character) {
  if (character.type !== 'chibi') return;
  const head = character.root.getObjectByName('HeadShape');
  head.scale.multiplyScalar(CHIBI_HEAD); head.position.y *= CHIBI_HEAD; // keep it sitting on the neck
}

// Build a character for a CharacterSpec. The pack draws it; we take over its joints (people/animation.js
// poses them every frame, the pack's own clips are not used) and attach the activity props.
// Returns the joints, the props, and measurements the cameras need. `sockets` are attach points for items.
function buildBody(spec) {
  const character = new Character(THREE, spec, CHARACTER_SIZES);
  character.mixer.stopAllAction();
  fitHead(character);
  const skinHex = new THREE.Color(character.inner.config.skin).getHex();
  const geometries = mergeJoints(character.root, skinHex);
  const root = new THREE.Group(); root.add(character.root);
  root.updateMatrixWorld(true);
  const node = name => character.root.getObjectByName(name);
  const hips = node('Hips'), spine = node('Spine'), neck = node('Neck'), head = node(HEAD_NODE[character.type]);
  const armL = node('ArmL'), armR = node('ArmR'), legL = node('LegL'), legR = node('LegR'), handL = node('HandL'), handR = node('HandR');
  const items = [node('ItemL'), node('ItemR')].filter(Boolean);

  // world metres per unit of the pack's skeleton, and the standing hip height in metres
  const unit = hips.parent.getWorldScale(v).y, standHip = hips.position.y * unit;
  const skinMeshes = []; root.traverse(o => { if (o.isMesh && o.material.color?.getHex() === skinHex) { o.userData.baseMat = o.material; skinMeshes.push(o); } });
  const faceMeshes = head.children.filter(o => o.isMesh && skinMeshes.includes(o)), face = boundsOf(faceMeshes);
  const chest = boundsOf(spine.children.filter(o => o.isMesh));
  const eyeY = face.getCenter(v).y + (face.max.y - face.min.y) * .1;

  // props are placed in world space around the resting hand, then attached so they follow it
  const held = makeHeldProps(), hand = handR.getWorldPosition(new THREE.Vector3());
  for (const prop of Object.values(held)) { prop.position.add(hand); handR.attach(prop); }
  const guitar = makeGuitar(); guitar.position.set(-.04, chest.getCenter(v).y, chest.max.z + .07); guitar.rotation.z = .35; guitar.scale.setScalar(.85); guitar.visible = false; spine.attach(guitar);
  if (spec.angry) addAngry(head, faceMeshes);

  // how tall they stand, with their hair and hat: the name label and the speech bubble sit above it
  const bodyMeshes = []; character.root.traverse(o => { if (o.isMesh) bodyMeshes.push(o); });
  const topY = boundsOf(bodyMeshes).max.y;
  const ring = new THREE.Mesh(ringGeo, ringMats.work); ring.rotation.x = -Math.PI / 2; ring.position.y = .015; ring.renderOrder = 2;
  const sockets = { head, torso: spine, leftHand: handL, rightHand: handR };
  return {
    root, character, hips, spine, neck, head, armL, armR, legL, legR, items, hold: heldItems(character),
    unit, standHip, eyeY, topY, ...held, guitar, ring, skinMeshes, sockets, geometries,
  };
}

// Eye height in metres: standing, or seated with the hips at `seatHipY`.
function eyeHeight(body, seatHipY = null) { return seatHipY == null ? body.eyeY : body.eyeY - body.standHip + seatHipY; }

// Free the pack's geometry and materials and the merged geometry (shared materials and the props stay).
function disposeBody(body) {
  body.character.dispose(); body.geometries.forEach(g => g.dispose());
  body.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); // the props, the guitar and the furious face (a shared one is just uploaded again when next drawn)
}

export { CHARACTER_SIZES, buildBody, disposeBody, eyeHeight, fitHead, ringMats };
