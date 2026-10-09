import * as THREE from 'three';
import { isLocalPlayer } from '../player/player.js';

// A small name label floating over every person a human is driving (not the autopilot people, and not yourself while you are
// steering, since you know who you are). It is drawn on a canvas as plain text, so nothing a server sends is ever read as markup.
// The "Names" button in the HUD turns them all off.

const nameState = { on: true };
const HEIGHT = 2.0; // metres above the floor
const textures = new Map();
const MAX_TEXTURES = 200;

function textureFor(text) {
  let entry = textures.get(text);
  if (entry) return entry;
  const font = '600 34px Archivo, "Helvetica Neue", Arial, sans-serif';
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40, h = 56;
  c.width = w; c.height = h; // (resizing clears the context: set it up again)
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = 'rgba(20, 28, 36, .8)';
  const r = h / 2;
  g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, h); g.arc(r, r, r, Math.PI / 2, -Math.PI / 2); g.fill();
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2 + 1);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  entry = { map, aspect: w / h };
  if (textures.size >= MAX_TEXTURES) { const [oldest] = textures.keys(); textures.get(oldest).map.dispose(); textures.delete(oldest); }
  textures.set(text, entry);
  return entry;
}

/** The name to show over this person, or null for none. */
const wanted = p => (nameState.on && p.controller === 'account' && p.state !== 'away' && p.body && !isLocalPlayer(p) ? p.name : null);

function drop(p) {
  const tag = p.nameTag;
  if (!tag) return;
  tag.parent?.remove(tag);
  tag.material.dispose(); // (the texture is shared and cached)
  p.nameTag = null;
}

/** Call every frame for every person: puts the label on, takes it off, or renames it, as needed. */
function updateNameTag(p) {
  const name = wanted(p);
  if (!name) { drop(p); return; }
  const tag = p.nameTag;
  if (tag && tag.userData.text === name && tag.userData.body === p.body) return;
  drop(p);
  const { map, aspect } = textureFor(name);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  const h = .24;
  sprite.scale.set(h * aspect, h, 1);
  sprite.position.set(0, HEIGHT / (p.spec.scale || 1), 0); // (the body is scaled by the person's height)
  sprite.renderOrder = 12;
  sprite.userData = { text: name, body: p.body };
  p.body.root.add(sprite);
  p.nameTag = sprite;
}

export { nameState, updateNameTag };
