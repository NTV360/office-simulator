import * as THREE from 'three';

// A speech bubble over whoever just spoke, for a few seconds. Drawn on a canvas as plain text (nothing from the server is read as markup),
// one bubble per person: a new line replaces the old one.

const BOTTOM = 2.28; // metres above the floor: just over the name label
const MAX_WIDTH = 420, FONT_PX = 30, LINE_PX = 38, PAD = 22, MAX_LINES = 4;
const FONT = `500 ${FONT_PX}px "Figtree", "Helvetica Neue", Arial, sans-serif`;

/** Break `text` into lines no wider than MAX_WIDTH (words, or characters inside a word that is too long), at most MAX_LINES. */
function wrap(g, text) {
  const lines = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of text.split(' ')) {
    const tryLine = line ? line + ' ' + word : word;
    if (g.measureText(tryLine).width <= MAX_WIDTH) { line = tryLine; continue; }
    push();
    if (g.measureText(word).width <= MAX_WIDTH) { line = word; continue; }
    for (const ch of word) { // a word wider than a whole line: break it
      if (g.measureText(line + ch).width > MAX_WIDTH) push();
      line += ch;
    }
  }
  push();
  if (lines.length > MAX_LINES) { lines.length = MAX_LINES; lines[MAX_LINES - 1] = lines[MAX_LINES - 1].slice(0, -1) + '…'; }
  return lines;
}

function make(text) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = FONT;
  const lines = wrap(g, text);
  const w = Math.ceil(Math.max(...lines.map(l => g.measureText(l).width))) + PAD * 2, h = lines.length * LINE_PX + PAD;
  c.width = w; c.height = h; // (resizing clears the context)
  g.font = FONT; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = 'rgba(255, 255, 255, .95)';
  const r = 16;
  g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(28, 36, 43, .35)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#1c242b';
  lines.forEach((l, i) => g.fillText(l, w / 2, PAD / 2 + LINE_PX * (i + .5) + 1));
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  return { map, aspect: w / h, height: h };
}

function remove(p) {
  const b = p.bubble;
  if (!b) return;
  b.parent?.remove(b);
  b.material.map.dispose(); b.material.dispose();
  p.bubble = null;
}

/** Show `text` over the person for a few seconds (longer for a longer line). */
function showBubble(p, text) {
  if (!p.body || !text) return;
  remove(p);
  const { map, aspect, height } = make(text);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  const worldH = height / 190; // 190 canvas pixels to the metre
  sprite.scale.set(worldH * aspect, worldH, 1);
  sprite.center.set(.5, 0); // anchored at its bottom edge, so it grows upward
  sprite.position.set(0, BOTTOM / (p.spec.scale || 1), 0);
  sprite.renderOrder = 13;
  sprite.userData = { until: performance.now() + Math.min(9000, 3500 + text.length * 60), body: p.body };
  p.body.root.add(sprite);
  p.bubble = sprite;
}

/** Call every frame for every person: takes the bubble away when its time is up (or when the person's body was replaced). */
function updateBubble(p) {
  const b = p.bubble;
  if (!b) return;
  if (performance.now() > b.userData.until || b.userData.body !== p.body || p.state === 'away') remove(p);
}

export { showBubble, updateBubble };
