import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MAX_ACCESSORIES, TYPES, addLog, normalizePlayerSpec, presetList, randomSpec, specOptions, vrandom } from '@office/shared';
import { Character } from '../character/pack/characters.js';
import { CHARACTER_SIZES, fitHead } from '../character/rig.js';
import { player, savePlayerSpec, setPlayerSpec } from '../player/player.js';
import { $ } from './dom.js';

/* ================= Character lab ================= */
// Edit how your character looks, with a live 3D preview (the pack's own character, animated; drag to turn it). It edits a draft and, on Save,
// hands it back: online the server makes it valid and tells everybody (PUT /api/character, see net/creator.js); offline it is kept in this
// browser. Shown the first time an account with a desk logs in (it cannot be skipped then) and again from the "Character lab" button.
// The preview has its own small renderer, made the first time the lab opens.
const creator = { open: false, draft: null, view: null, keepStyle: false, spin: false, stage: null, finish: null, onSave: null, onLogout: null, required: false, saving: false, inert: [], returnTo: null, folds: new Set() };
const STYLE_LABEL = { chibi: 'Chibi', blocky: 'Blocky' };
const SLOT_LABELS = { head: 'Head', face: 'Face', body: 'Body', back: 'Back', hand: 'Hands' };

// Option names as people read them: 'longsleeve' → 'Long sleeve', 'widePants' → 'Wide pants'.
const NICE = { tshirt: 'T-shirt', longsleeve: 'Long sleeve', tanktop: 'Tank top', hightops: 'High-tops', fullBeard: 'Full beard', santaHat: 'Santa hat' };
const words = s => NICE[s] ?? s.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
const clone = o => JSON.parse(JSON.stringify(o));

// ----- preview stage -----
function makeStage() {
  const host = $('creatorStage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 1.6, maxDistance: 9, maxPolarAngle: Math.PI * .52 });
  camera.position.set(2.8, 1.5, 4.9); controls.target.set(0, .8, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6e2, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .5, far: 30 });
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .18 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const hero = new Character(THREE, creator.draft, CHARACTER_SIZES);
  fitHead(hero); scene.add(hero.root);
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  return { renderer, scene, camera, controls, hero, resize, clock: new THREE.Clock(), raf: 0 };
}
function loop() {
  const s = creator.stage; if (!creator.open) return;
  const dt = s.clock.getDelta();
  s.hero.update(dt); if (creator.spin) s.hero.root.rotation.y += dt * .7;
  s.controls.update(); s.renderer.render(s.scene, s.camera);
  s.raf = requestAnimationFrame(loop);
}

// ----- open / close -----
// Open the lab on `start` (default: your look). Resolves with the saved look, or null if it was closed without saving. `onSave(spec)`
// stores it and resolves `{ ok, spec, message }` (the lab stays open with the message when it fails); without one the look is kept in this
// browser. `required`: the first time, it cannot be closed without saving.
function openCreator({ start = null, onSave = null, required = false, onLogout = null } = {}) {
  if (creator.open) return Promise.resolve(null);
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  creator.open = true; $('creator').hidden = false;
  creator.onSave = onSave; creator.required = required; creator.onLogout = onLogout; creator.saving = false;
  // a modal dialog: the page behind it can not be reached with the keyboard or the pointer, and focus comes back when it closes
  creator.returnTo = document.activeElement;
  creator.inert = [...document.body.children].filter(e => e.id !== 'creator' && e.tagName !== 'SCRIPT' && !e.inert);
  creator.inert.forEach(e => { e.inert = true; });
  $('creatorLogout').hidden = !(required && onLogout);
  creator.draft = clone(normalizePlayerSpec(start ?? player.spec));
  $('creatorCancel').hidden = $('creatorBack').hidden = required;
  $('creatorMessage').textContent = '';
  if (!creator.stage) creator.stage = makeStage();
  creator.stage.resize(); creator.stage.clock.getDelta();
  rebuild();
  loop();
  $('creatorSave').focus();
  return new Promise(resolve => { creator.finish = resolve; });
}
async function closeCreator(save) {
  if (!creator.open || creator.saving) return; // (a save in flight is not raced by a close)
  if (!save && creator.required) return;
  let saved = null;
  if (save) {
    const spec = normalizePlayerSpec(creator.draft);
    if (creator.onSave) {
      creator.saving = true; $('creatorSave').disabled = $('creatorCancel').disabled = $('creatorBack').disabled = true;
      const r = await creator.onSave(spec).catch(() => null);
      creator.saving = false; $('creatorSave').disabled = $('creatorCancel').disabled = $('creatorBack').disabled = false;
      if (!r?.ok) { $('creatorMessage').textContent = r?.message || 'Could not save. Try again.'; return; }
      saved = r.spec ?? spec;
    } else { setPlayerSpec(spec); savePlayerSpec(); addLog('You changed your look'); saved = spec; }
  }
  creator.open = false; $('creator').hidden = true;
  cancelAnimationFrame(creator.stage.raf);
  creator.inert.forEach(e => { e.inert = false; }); creator.inert = [];
  try { creator.returnTo?.focus?.(); } catch (_) { /* gone from the page */ }
  const done = creator.finish; creator.finish = null;
  if (done) done(saved);
}

// ----- editing -----
function rebuild(refreshPanel = true) {
  const hero = creator.stage.hero;
  hero.set(normalizePlayerSpec(creator.draft), true); fitHead(hero); // (draws what Save will send)
  creator.view = hero.resolved;
  $('creatorTitle').textContent = 'Your character';
  $('creatorWho').textContent = STYLE_LABEL[creator.draft.type];
  renderClips();
  if (refreshPanel) renderPanel(); else updateJson();
}
// An edit that makes the character no longer match a preset renames it "Custom".
function edited() {
  const d = creator.draft;
  if (presetList().some(p => p.spec.name === d.name)) d.name = 'Custom';
}
// Set one field of a part, starting from what's drawn and keeping fields the other style uses.
function setPart(part, key, value) { const d = creator.draft; d[part] = { ...(creator.view[part] || {}), ...(d[part] || {}), [key]: value }; }
function load(spec) {
  creator.draft = { ...clone(spec), type: creator.keepStyle ? creator.draft.type : spec.type, angry: false };
  rebuild();
}
// Colour inputs fire continuously; redraw the character live and the panel only when the pick is final.
const live = fn => (value, isLive) => { fn(value); edited(); rebuild(!isLive); };

// ----- panel widgets -----
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'style') e.style.cssText = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}
const chip = (label, pressed, onclick, title) => el('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(!!pressed), title, on: { click: onclick } }, label);
const row = (label, ...content) => el('div', { class: 'cl-row' }, el('div', { class: 'cl-lbl' }, label), el('div', {}, ...content));
// A collapsible group: the header shows the title and a one-line summary of the current choice.
// Which groups are open is remembered while the lab is in use.
function fold(key, title, summary, ...content) {
  return el('details', { class: 'cl-fold', open: creator.folds.has(key), on: { toggle: ev => { if (ev.target.open) creator.folds.add(key); else creator.folds.delete(key); } } },
    el('summary', {}, el('span', { class: 'fold-title' }, title), el('span', { class: 'fold-sum' }, summary)),
    el('div', { class: 'fold-body' }, ...content));
}
const dot = c => el('i', { class: 'fold-dot', style: `background:${hexOf(c)}` });
const sum = (...parts) => el('span', {}, ...parts.filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x]));
const segmented = (values, current, onPick) => el('div', { class: 'chips' }, values.map(v => chip(words(v), v === current, () => onPick(v))));
const hexOf = c => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c || '#888888');
function colorInput(id, value, onInput, onChange) {
  return el('input', { type: 'color', id: 'cl-' + id, value: hexOf(value), 'aria-label': words(id), on: {
    input: e => onInput(e.target.value, true), change: e => (onChange || onInput)(e.target.value) } });
}
function swatches(id, palette, current, onPick) {
  const cur = hexOf(current).toLowerCase();
  return el('div', { class: 'cl-swatches' },
    Object.entries(palette).map(([name, c]) => el('button', {
      type: 'button', class: 'cl-sw', title: words(name), 'aria-label': words(name), 'aria-pressed': String(cur === c.toLowerCase()),
      style: `background:${c}`, on: { click: () => onPick(c) } })),
    colorInput(id, current, onPick, onPick));
}

// ----- panel -----
function renderPanel() {
  const panel = $('creatorPanel'), scroll = panel.scrollTop;
  const focusables = () => [...panel.querySelectorAll('summary, button, input, textarea')];
  const focused = focusables().indexOf(document.activeElement); // (the panel is redrawn after every choice: put the focus back where it was)
  const d = creator.draft, view = creator.view, o = specOptions(d.type), notes = creator.stage.hero.notes ?? [];
  const presets = presetList();
  panel.replaceChildren(
    fold('look', 'Style & presets', sum(STYLE_LABEL[d.type], presets.some(p => p.spec.name === d.name) ? d.name : 'Custom'),
      row('Style', segmented(TYPES, d.type, v => { d.type = v; rebuild(); })),
      notes.length ? el('div', { class: 'cl-note' }, `In this style: ${notes.join(' · ')}. Switch back to restore.`) : null,
      ...TYPES.map(type => el('div', { class: 'cl-stack' },
        el('div', { class: 'cl-lbl' }, `${STYLE_LABEL[type]} designs`),
        el('div', { class: 'cl-presets' }, presets.filter(p => p.type === type).map(p => chip(p.spec.name, d.name === p.spec.name && d.type === type, () => load(p.spec)))))),
      el('label', { class: 'cl-toggle' }, el('input', { type: 'checkbox', checked: creator.keepStyle, on: { change: e => { creator.keepStyle = e.target.checked; } } }), 'Load presets in the current style'),
      el('div', { class: 'cl-actions' },
        el('button', { type: 'button', class: 'btn sm', on: { click: () => { creator.draft = { ...randomSpec(undefined, vrandom), type: d.type, name: 'Random', angry: false }; rebuild(); } } }, 'Randomize'),
        el('button', { type: 'button', class: 'btn sm', on: { click: () => load(presets.find(p => p.type === d.type && p.key === 'defaultMale').spec) } }, 'Default male'),
        el('button', { type: 'button', class: 'btn sm', on: { click: () => load(presets.find(p => p.type === d.type && p.key === 'defaultFemale').spec) } }, 'Default female'))),

    fold('body', 'Body', sum(dot(view.skin), words(view.body), `${view.build} build`, `${view.height} height`),
      row('Body', segmented(o.body, view.body, v => { d.body = v; if (v === 'male' && view.top.style === 'dress') setPart('top', 'style', 'tshirt'); edited(); rebuild(); })),
      row('Build', segmented(o.build, view.build, v => { d.build = v; edited(); rebuild(); })),
      row('Height', segmented(o.height, view.height, v => { d.height = v; edited(); rebuild(); })),
      row('Skin', swatches('skin', o.palettes.skin, view.skin, live(v => { d.skin = v; }))),
      o.eyes ? row('Eyes', segmented(o.eyes, view.eyes?.style, v => { d.eyes = { ...(view.eyes || {}), ...(d.eyes || {}), style: v }; edited(); rebuild(); })) : null,
      o.eyes && ['closed', 'dots'].includes(view.eyes?.style) ? null
        : row('Eye color', swatches('eyes', o.palettes.eyes, view.eyes?.color, live(v => { d.eyes = { ...(view.eyes || {}), ...(d.eyes || {}), color: v }; }))),
      row('Details',
        d.type === 'chibi'
          ? el('label', { class: 'cl-toggle' }, el('input', { type: 'checkbox', checked: !!view.cheeks, on: { change: e => { d.cheeks = e.target.checked; edited(); rebuild(); } } }), 'Rosy cheeks')
          : el('label', { class: 'cl-toggle' }, el('input', { type: 'checkbox', checked: !!view.freckles, on: { change: e => { d.freckles = e.target.checked; edited(); rebuild(); } } }), 'Freckles'),
        view.body === 'female' ? el('div', { class: 'cl-colorline' }, 'Lips', colorInput('lips', d.lips ?? '#c4566a', live(v => { d.lips = v; }))) : null)),

    fold('hair', 'Hair', sum(view.hair.style === 'none' ? null : dot(view.hair.color), view.hair.style === 'none' ? 'Bald' : words(view.hair.style), view.facialHair.style !== 'none' ? words(view.facialHair.style) : null),
      row('Style', segmented(o.hair, view.hair.style, v => { setPart('hair', 'style', v); edited(); rebuild(); })),
      row('Color', swatches('hairColor', o.palettes.hair, view.hair.color, live(v => setPart('hair', 'color', v)))),
      row('Facial', segmented(o.facialHair, view.facialHair.style, v => { setPart('facialHair', 'style', v); edited(); rebuild(); })),
      view.facialHair.style !== 'none' ? row('Beard color', el('div', { class: 'cl-colorline' },
        colorInput('beardColor', view.facialHair.color ?? view.hair.color, live(v => setPart('facialHair', 'color', v))),
        el('button', { type: 'button', class: 'btn sm', on: { click: () => { d.facialHair = { ...(d.facialHair || {}) }; delete d.facialHair.color; rebuild(); } } }, 'Match hair'))) : null),

    clothing('Top', 'top', o.top.filter(t => view.body === 'female' || t !== 'dress')),
    view.top.style === 'dress' ? null : clothing('Bottom', 'bottom', o.bottom),
    clothing('Shoes', 'shoes', o.shoes),

    fold('acc', 'Accessories', accs().length ? accs().map(a => words(a.type)).join(', ') : 'None',
      ...Object.entries(groupBySlot(o.accessories)).map(([slot, items]) => row(SLOT_LABELS[slot] ?? words(slot),
        el('div', { class: 'chips' }, items.map(a => chip(words(a.name), hasAcc(a.name), () => toggleAcc(a.name, o.accessories)))))),
      activeAccessories(o.accessories),
      (creator.stage.hero.inner.warnings ?? []).length ? el('div', { class: 'cl-note' }, creator.stage.hero.inner.warnings.join(' · ')) : null),

    fold('share', 'Share', 'Copy or paste a character',
      el('textarea', { id: 'creatorJson', readonly: true, 'aria-label': 'Character config', spellcheck: 'false' }),
      el('div', { class: 'cl-actions' },
        el('button', { type: 'button', class: 'btn sm', id: 'creatorCopy', on: { click: copyJson } }, 'Copy config'),
        el('button', { type: 'button', class: 'btn sm', on: { click: pasteJson } }, 'Load config from text'))),
  );
  updateJson();
  panel.scrollTop = scroll;
  if (focused >= 0) focusables()[focused]?.focus({ preventScroll: true });
}

function clothing(title, key, styles) {
  const d = creator.draft, part = creator.view[key], accent = d[key]?.accent;
  return fold(key, title, sum(part.style === 'bare' ? null : dot(part.color), words(part.style)),
    row('Style', segmented(styles, part.style, v => { setPart(key, 'style', v); edited(); rebuild(); })),
    part.style === 'bare' ? null : row('Color', el('div', { class: 'cl-colorline' },
      colorInput(key + 'Color', part.color, live(v => setPart(key, 'color', v))),
      el('span', {}, 'Accent'),
      colorInput(key + 'Accent', accent ?? '#ffffff', live(v => setPart(key, 'accent', v))),
      accent !== undefined ? el('button', { type: 'button', class: 'btn sm', on: { click: () => { d[key] = { ...(d[key] || {}) }; delete d[key].accent; rebuild(); } } }, 'Default accent') : null)));
}

// ----- accessories -----
function groupBySlot(defs) {
  const g = {};
  for (const a of defs) (g[a.slot] ??= []).push(a);
  const order = Object.keys(SLOT_LABELS);
  return Object.fromEntries(Object.entries(g).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])));
}
const accs = () => (creator.draft.accessories ??= clone(creator.view.accessories ?? []));
const hasAcc = name => accs().some(a => a.type === name);
// Add or remove an accessory. Things that can't be worn together swap out: two hats, two pairs of
// glasses, or two items for the same hand (a one-handed item moves to the free hand when it can).
function toggleAcc(name, defs) {
  const d = creator.draft, byName = Object.fromEntries(defs.map(a => [a.name, a])), def = byName[name];
  if (hasAcc(name)) d.accessories = accs().filter(a => a.type !== name);
  else {
    const keep = accs().filter(a => {
      const o = byName[a.type];
      if (!o) return true; // the other style's item: keep it for when you switch back
      if (def.hat && o.hat) return false;
      if (['glasses', 'sunglasses'].includes(name) && ['glasses', 'sunglasses'].includes(a.type)) return false;
      if (def.slot === 'hand' && o.slot === 'hand') {
        const need = def.hand === 'both' ? ['L', 'R'] : [def.hand];
        const uses = o.hand === 'both' ? ['L', 'R'] : [a.side ?? o.hand];
        if (!uses.some(h => need.includes(h))) return true;
        if (o.hand !== 'both' && def.hand !== 'both') { a.side = uses[0] === 'L' ? 'R' : 'L'; return true; }
        return false;
      }
      return true;
    });
    if (keep.length >= MAX_ACCESSORIES) { $('creatorMessage').textContent = `At most ${MAX_ACCESSORIES} accessories: take one off first.`; return; }
    d.accessories = [...keep, { type: name }];
  }
  $('creatorMessage').textContent = '';
  edited(); rebuild();
}
function activeAccessories(defs) {
  const list = accs(), byName = Object.fromEntries(defs.map(a => [a.name, a]));
  if (!list.length) return el('div', { class: 'cl-note' }, 'No accessories yet. Hand items swap automatically when they clash; they are put away while you sit or play.');
  return el('div', { class: 'cl-acc' }, list.map((a, i) => {
    const def = byName[a.type], oneHand = def?.slot === 'hand' && def.hand !== 'both', side = a.side ?? def?.hand;
    return el('div', { class: 'cl-acc-item', style: def ? '' : 'opacity:.6' },
      el('span', {}, words(a.type), def ? '' : ` (${STYLE_LABEL[creator.draft.type === 'chibi' ? 'blocky' : 'chibi']} only)`),
      oneHand ? el('button', { type: 'button', class: 'btn sm', title: 'Switch hand', on: { click: () => { a.side = side === 'L' ? 'R' : 'L'; edited(); rebuild(); } } }, side === 'L' ? 'Left hand' : 'Right hand') : null,
      def ? colorInput('acc' + i, a.color ?? def.color ?? '#888888', live(v => { a.color = v; })) : null,
      el('button', { type: 'button', class: 'btn sm', title: 'Remove', 'aria-label': 'Remove ' + words(a.type), on: { click: () => { list.splice(i, 1); edited(); rebuild(); } } }, '✕'));
  }));
}

// ----- share as JSON -----
function updateJson() { const t = $('creatorJson'); if (t && t.readOnly) t.value = JSON.stringify(normalizePlayerSpec(creator.draft), null, 2); }
async function copyJson() {
  const b = $('creatorCopy'), t = $('creatorJson');
  try { await navigator.clipboard.writeText(t.value); b.textContent = 'Copied'; }
  catch (_) { t.select(); b.textContent = 'Selected, press Ctrl+C'; }
  setTimeout(() => { b.textContent = 'Copy config'; }, 1600);
}
function pasteJson() {
  const t = $('creatorJson');
  t.readOnly = false; t.value = ''; t.placeholder = 'Paste a config here, then click outside the box'; t.focus();
  t.addEventListener('blur', () => {
    let raw = null; try { raw = JSON.parse(t.value); } catch (_) {}
    t.readOnly = true;
    if (raw && typeof raw === 'object') { creator.draft = normalizePlayerSpec({ type: creator.draft.type, ...raw }); rebuild(); } else updateJson();
  }, { once: true });
}

// ----- animation buttons -----
function renderClips() {
  const hero = creator.stage.hero, cur = hero.current?.getClip().name;
  $('creatorClips').replaceChildren(...hero.clipNames.map(n => el('button', { type: 'button', 'aria-pressed': String(n === cur), on: { click: () => { hero.play(n); renderClips(); } } }, n)));
}

/** Online, the buttons open the lab with the server's save; offline, with the browser's own. */
let handler = () => openCreator();
const setCreatorHandler = fn => { handler = fn; };
function initCreator() {
  $('openCreator').onclick = () => handler();
  $('fpCreator').onclick = () => handler();
  $('creatorSave').onclick = () => closeCreator(true);
  $('creatorCancel').onclick = () => closeCreator(false);
  $('creatorBack').onclick = () => closeCreator(false);
  $('creatorLogout').onclick = () => { if (creator.onLogout) creator.onLogout(); };
  $('creatorSpin').onclick = e => { creator.spin = !creator.spin; e.currentTarget.setAttribute('aria-pressed', String(creator.spin)); };
  // keys typed in the lab must not steer the camera or the player, wherever the focus is (a click on a choice redraws the panel and the focus
  // falls out of it), and Escape closes it
  addEventListener('keydown', e => { if (!creator.open) return; e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeCreator(false); } }, true);
  $('creatorMessage').hidden = false;
}

export { closeCreator, creator, initCreator, openCreator, setCreatorHandler };
