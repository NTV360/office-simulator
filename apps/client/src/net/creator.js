import * as THREE from 'three';
import { PARTS, SCALE_RANGE, STYLE_OPTIONS, normalizePlayerSpec } from '@office/shared';
import { buildBody } from '../character/rig.js';

// Character creation: pick how your person looks, with a live 3D preview. Plain DOM and its own small three.js scene (so the
// office is not touched). The server makes whatever is sent valid again (PUT /api/character); this page only offers valid choices.
// Shown the first time a person with a desk logs in, and again from the "Character" button next to the account name.

/** Your saved look and the starting look. Null if the server cannot be reached or you are logged out. */
export async function getCharacter(base) {
  try {
    const r = await fetch(`${base}/api/character`, { credentials: 'same-origin' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Save a look. Resolves { ok, spec } (the look as the server made it valid) or { ok: false, message }. */
export async function saveCharacter(base, spec) {
  try {
    const r = await fetch(`${base}/api/character`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }),
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, spec: json.spec };
    return { ok: false, message: json.message || `Something went wrong (${r.status}).` };
  } catch { return { ok: false, message: 'Cannot reach the server. Try again in a moment.' }; }
}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};

const SWATCHES = [
  ['skin', 'Skin', false], ['hair', 'Hair colour', false], ['shirt', 'Shirt', false], ['pants', 'Trousers', false], ['shoes', 'Shoes', false],
  ['jacket', 'Jacket', true], ['headphones', 'Headphones', true],
];
const STYLE_NAMES = { short: 'Short', long: 'Long', bun: 'Bun', buzz: 'Buzz', curly: 'Curly', side: 'Side part', bob: 'Bob' };

/**
 * Show the page and wait. Resolves with the saved look, or null if the person closed it without saving (only possible when
 * `required` is false). `start` is the look to begin from.
 */
export function showCreator(base, start, { required = false } = {}) {
  return new Promise(resolve => {
    document.getElementById('creatorScreen')?.remove();
    let spec = normalizePlayerSpec(start);
    const message = el('p', { class: 'login-note', role: 'alert' });

    // ---- the preview: the real rig, turning slowly; drag to turn it yourself
    const canvas = el('canvas', { id: 'creatorPreview', width: '240', height: '300', 'aria-label': 'Preview of your character' });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(240, 300, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a0, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 3, 2.5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(34, 240 / 300, 0.1, 20);
    camera.position.set(0, 1.05, 3.9); camera.lookAt(0, 0.92, 0);
    let body = null, turn = 0.5, dragging = false, lastX = 0, raf = 0;
    const rebuild = () => {
      if (body) scene.remove(body.root);
      body = buildBody(spec);
      body.root.rotation.y = turn;
      body.ring.visible = false;
      scene.add(body.root);
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dragging) turn += 0.008;
      if (body) body.root.rotation.y = turn;
      renderer.render(scene, camera);
    };
    canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (dragging) { turn += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
    const stopDrag = () => { dragging = false; };
    canvas.addEventListener('pointerup', stopDrag); canvas.addEventListener('pointercancel', stopDrag);

    // ---- the controls
    const change = patch => { spec = normalizePlayerSpec({ ...spec, ...patch }); message.textContent = ''; rebuild(); refresh(); };
    const refreshers = [];
    const refresh = () => refreshers.forEach(f => f());

    const swatchRow = ([key, label, optional]) => {
      const row = el('div', { class: 'creator-swatches', role: 'group', 'aria-label': label });
      const options = optional ? [null, ...PARTS[key]] : PARTS[key];
      const buttons = options.map(color => {
        const b = el('button', { type: 'button', class: 'creator-swatch' + (color === null ? ' none' : ''), 'data-key': key, 'data-color': color ?? 'none', 'aria-pressed': 'false', 'aria-label': `${label}: ${color ?? 'none'}`, title: color ?? 'None' });
        if (color) b.style.background = color;
        b.addEventListener('click', () => change({ [key]: color }));
        return [color, b];
      });
      row.append(...buttons.map(([, b]) => b));
      refreshers.push(() => buttons.forEach(([color, b]) => b.setAttribute('aria-pressed', String((spec[key] ?? null) === color))));
      return el('div', { class: 'creator-field' }, el('span', { class: 'creator-label' }, label), row);
    };

    const styleButtons = STYLE_OPTIONS.map(s => {
      const b = el('button', { type: 'button', class: 'creator-chip', 'data-style': s, 'aria-pressed': 'false' }, STYLE_NAMES[s] ?? s);
      b.addEventListener('click', () => change({ style: s }));
      return [s, b];
    });
    refreshers.push(() => styleButtons.forEach(([s, b]) => b.setAttribute('aria-pressed', String(spec.style === s))));

    const toggle = (key, label) => {
      const input = el('input', { type: 'checkbox', id: `creator-${key}` });
      input.addEventListener('change', () => change({ [key]: input.checked }));
      refreshers.push(() => { input.checked = !!spec[key]; });
      return el('label', { class: 'creator-toggle' }, input, label);
    };

    const height = el('input', { type: 'range', id: 'creatorHeight', min: String(SCALE_RANGE[0]), max: String(SCALE_RANGE[1]), step: '0.01', 'aria-label': 'Height' });
    height.addEventListener('input', () => change({ scale: Number(height.value) }));
    refreshers.push(() => { height.value = String(spec.scale); });

    const save = el('button', { type: 'button', class: 'btn primary', id: 'creatorSave' }, 'Save');
    const cancel = el('button', { type: 'button', class: 'btn', id: 'creatorCancel' }, 'Cancel');
    if (required) cancel.hidden = true;

    const finish = result => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      renderer.dispose();
      screen.remove();
      resolve(result);
    };
    const onKey = e => { if (e.key === 'Escape' && !required) finish(null); };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => finish(null));
    save.addEventListener('click', async () => {
      save.disabled = true; message.textContent = '';
      const r = await saveCharacter(base, spec);
      save.disabled = false;
      if (r.ok) finish(r.spec); else message.textContent = r.message;
    });

    const controls = el('div', { class: 'creator-controls' },
      ...SWATCHES.map(swatchRow),
      el('div', { class: 'creator-field' }, el('span', { class: 'creator-label' }, 'Hair style'), el('div', { class: 'creator-chips', role: 'group', 'aria-label': 'Hair style' }, ...styleButtons.map(([, b]) => b))),
      el('div', { class: 'creator-field creator-toggles' }, toggle('glasses', 'Glasses'), toggle('longSleeve', 'Long sleeves')),
      el('div', { class: 'creator-field' }, el('label', { for: 'creatorHeight', class: 'creator-label' }, 'Height'), height));

    const screen = el('div', { id: 'creatorScreen', class: 'login-screen creator-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'creatorTitle' },
      el('div', { class: 'login-card creator-card' },
        el('p', { class: 'eyebrow' }, required ? 'Welcome' : 'Your character'),
        el('h2', { id: 'creatorTitle' }, required ? 'Create your character' : 'Change your character'),
        el('div', { class: 'creator-body' }, el('div', { class: 'creator-preview' }, canvas, el('p', { class: 'login-hint' }, 'Drag to turn')), controls),
        message,
        el('div', { class: 'creator-actions' }, cancel, save)));
    document.body.append(screen);
    rebuild(); refresh(); frame();
    save.focus();
  });
}
