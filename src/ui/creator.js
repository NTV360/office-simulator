import { PRESETS, presetSpec } from '../character/presets.js';
import { COSTUME_OPTIONS, CREATOR_COLORS, DEFAULT_SPEC, HAT_OPTIONS, SCALE_RANGE, STYLE_OPTIONS, randomPlayerSpec, sameLook } from '../character/spec.js';
import { ctl } from '../player/control.js';
import { player, setPlayerSpec } from '../player/player.js';
import { $ } from './dom.js';
import { makePreview } from './preview.js';

// Character creator: opened while walking as yourself (first or third person). Body parts and accessories are
// edited one field at a time and applied to the player's body live. The sprite avatars are starting looks.
const SPRITES = import.meta.glob('../assets/avatars/*.png', { eager: true, query: '?url', import: 'default' });
const spriteUrl = id => SPRITES[`../assets/avatars/${String(id).padStart(2, '0')}.png`];

const STYLE_LABELS = { short: 'Short', buzz: 'Buzz', side: 'Side part', long: 'Long', bob: 'Bob', bun: 'Bun', pigtails: 'Pigtails', braid: 'Braid', curly: 'Curly', afro: 'Afro', spiky: 'Spiky', bald: 'Bald' };
const HAT_LABELS = { pilot: 'Pilot cap', grad: 'Graduation', beanie: 'Beanie', hood: 'Hood' };
const COSTUME_LABELS = { vampire: 'Vampire', snowman: 'Snowman', frank: 'Frankenstein', wolf: 'Werewolf', ghost: 'Ghost' };
const NONE = [null, 'None'];
const named = (list, labels) => list.map(v => [v, labels[v]]);

// What the creator shows. Each control edits one spec field. kinds:
//   choice       buttons, one per [value, label]
//   color        swatches from CREATOR_COLORS[palette], plus a picker for any color
//   colorOrNone  the same with a "none" swatch first, for accessories that can be off
//   range        a slider
// `when` hides a control until it is relevant; `label` captions it.
const BODY = [
  { title: 'Skin', controls: [{ kind: 'color', key: 'skin', palette: 'skin' }] },
  { title: 'Hair', controls: [
    { kind: 'choice', key: 'style', options: named(STYLE_OPTIONS, STYLE_LABELS) },
    { kind: 'color', key: 'hair', palette: 'hair', label: 'Color', when: s => s.style !== 'bald' },
  ] },
  { title: 'Eyes', controls: [{ kind: 'color', key: 'eyes', palette: 'eyes' }] },
  { title: 'Top', controls: [
    { kind: 'color', key: 'shirt', palette: 'shirt' },
    { kind: 'choice', key: 'longSleeve', options: [[false, 'Short sleeves'], [true, 'Long sleeves']] },
  ] },
  { title: 'Legs', controls: [
    { kind: 'color', key: 'pants', palette: 'pants' },
    { kind: 'choice', key: 'shorts', options: [[false, 'Trousers'], [true, 'Shorts']] },
  ] },
  { title: 'Shoes', controls: [{ kind: 'color', key: 'shoes', palette: 'shoes' }] },
  { title: 'Height', controls: [{ kind: 'range', key: 'scale', min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: .01 }] },
];
const ACCESSORIES = [
  { title: 'Glasses', controls: [{ kind: 'choice', key: 'glasses', options: [[false, 'None'], [true, 'Glasses']] }] },
  { title: 'Hat', controls: [
    { kind: 'choice', key: 'hat', options: [NONE, ...named(HAT_OPTIONS, HAT_LABELS)] },
    { kind: 'color', key: 'hatColor', palette: 'accent', label: 'Color', when: s => !!s.hat },
    { kind: 'color', key: 'hatBand', palette: 'accent', label: 'Band', when: s => s.hat === 'beanie' },
  ] },
  { title: 'Headphones', controls: [{ kind: 'colorOrNone', key: 'headphones', palette: 'accent' }] },
  { title: 'Goggles', controls: [
    { kind: 'colorOrNone', key: 'goggles', palette: 'accent', label: 'Frame' },
    { kind: 'color', key: 'gogglesLens', palette: 'accent', label: 'Lens', when: s => !!s.goggles },
  ] },
  { title: 'Earrings', controls: [{ kind: 'colorOrNone', key: 'earrings', palette: 'accent' }] },
  { title: 'Scarf', controls: [{ kind: 'colorOrNone', key: 'scarf', palette: 'accent' }] },
  { title: 'Tie', controls: [{ kind: 'colorOrNone', key: 'tie', palette: 'accent' }] },
  { title: 'Jacket', controls: [{ kind: 'colorOrNone', key: 'jacket', palette: 'jacket' }] },
  { title: 'Costume', controls: [{ kind: 'choice', key: 'costume', options: [NONE, ...named(COSTUME_OPTIONS, COSTUME_LABELS)] }] },
];

const refs = []; // one entry per control: { c, el, buttons, custom, input, out }, so edits can refresh pressed states
const presetButtons = []; // { spec, el } for the character grid
let preview = null, panel = null;

const val = v => JSON.stringify(v); // button values are stored as JSON so true, false and null survive the DOM
function button(cls, text, key, value) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.dataset.key = key; b.dataset.val = val(value); b.setAttribute('aria-pressed', 'false');
  return b;
}
function swatch(key, hex) {
  const b = button('cr-sw', '', key, hex); b.style.setProperty('--sw', hex); b.title = hex; b.setAttribute('aria-label', hex);
  return b;
}

function buildControl(c) {
  const el = document.createElement('div'); el.className = 'cr-ctl';
  if (c.label) { const l = document.createElement('div'); l.className = 'cr-lbl'; l.textContent = c.label; el.append(l); }
  const row = document.createElement('div'); row.className = 'cr-opts'; el.append(row);
  const ref = { c, el, buttons: [], custom: null, input: null, out: null };
  if (c.kind === 'choice') for (const [v, text] of c.options) { const b = button('cr-opt', text, c.key, v); ref.buttons.push(b); row.append(b); }
  if (c.kind === 'color' || c.kind === 'colorOrNone') {
    if (c.kind === 'colorOrNone') { const b = button('cr-sw cr-none', '', c.key, null); b.title = 'None'; b.setAttribute('aria-label', 'None'); ref.buttons.push(b); row.append(b); }
    for (const hex of CREATOR_COLORS[c.palette]) { const b = swatch(c.key, hex); ref.buttons.push(b); row.append(b); }
    const wrap = document.createElement('label'); wrap.className = 'cr-sw cr-custom'; wrap.title = 'Pick any color';
    const input = document.createElement('input'); input.type = 'color'; input.dataset.key = c.key; input.setAttribute('aria-label', 'Custom color');
    wrap.append(input); row.append(wrap); ref.custom = wrap; ref.input = input;
  }
  if (c.kind === 'range') {
    const input = document.createElement('input'); input.type = 'range'; Object.assign(input, { min: c.min, max: c.max, step: c.step }); input.dataset.key = c.key; input.setAttribute('aria-label', c.key === 'scale' ? 'Height' : c.key);
    const out = document.createElement('span'); out.className = 'cr-out'; row.append(input, out); ref.input = input; ref.out = out;
  }
  refs.push(ref);
  return el;
}

function buildSection(sec) {
  const el = document.createElement('section'); el.className = 'cr-sec';
  const h = document.createElement('h3'); h.textContent = sec.title; el.append(h);
  for (const c of sec.controls) el.append(buildControl(c));
  return el;
}

// The sprite grid: pick one to start from, then change any part.
function buildCharacters() {
  const pane = $('crChars'), grid = document.createElement('div'); grid.className = 'cr-grid';
  for (const p of PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cr-chr'; b.dataset.preset = p.id; b.setAttribute('aria-pressed', 'false');
    const name = p.name || `Character ${p.id}`; b.title = name; b.setAttribute('aria-label', name);
    const img = document.createElement('img'); img.src = spriteUrl(p.id); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
    b.append(img); grid.append(b); presetButtons.push({ spec: presetSpec(p), el: b });
  }
  pane.append(grid);
}

// Refresh every control (pressed states, picker values, which controls are visible) from the spec.
function sync(spec) {
  for (const r of refs) {
    const { c } = r, v = spec[c.key];
    r.el.hidden = !!c.when && !c.when(spec);
    if (c.kind === 'choice') for (const b of r.buttons) b.setAttribute('aria-pressed', String(b.dataset.val === val(v)));
    if (c.kind === 'color' || c.kind === 'colorOrNone') {
      let matched = false;
      for (const b of r.buttons) { const on = b.dataset.val === val(v); matched ||= on && v !== null; b.setAttribute('aria-pressed', String(on)); }
      const custom = v !== null && !matched;
      r.custom.classList.toggle('on', custom);
      r.custom.style.setProperty('--sw', custom ? v : 'transparent');
      if (v !== null) r.input.value = v;
    }
    if (c.kind === 'range') { r.input.value = v; r.out.textContent = Math.round(v * 100) + '%'; }
  }
  for (const p of presetButtons) p.el.setAttribute('aria-pressed', String(sameLook(p.spec, spec)));
}

// Apply a spec to the player and refresh the creator and its preview.
function apply(raw) {
  const next = setPlayerSpec(raw);
  sync(next); if (preview) preview.setSpec(next);
}
const edit = patch => apply({ ...player.spec, ...patch });

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.tab === name)); $(b.getAttribute('aria-controls')).hidden = b.dataset.tab !== name; });
}

function open() {
  if (!ctl.active || ctl.menu) return;
  ctl.menu = close;
  panel.hidden = false; document.body.classList.add('cr-open');
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  sync(player.spec);
  if (!preview) preview = makePreview($('crPreview'));
  $('crStage').hidden = !preview;
  if (preview) { preview.setSpec(player.spec); preview.start(); }
  $('crDone').focus();
}
function close() {
  if (ctl.menu !== close) return;
  ctl.menu = null;
  panel.hidden = true; document.body.classList.remove('cr-open');
  if (preview) preview.stop();
  if (panel.contains(document.activeElement)) document.activeElement.blur();
}

function initCreator() {
  panel = $('creator');
  const body = $('crBody');
  for (const sec of BODY) $('crParts').append(buildSection(sec));
  for (const sec of ACCESSORIES) $('crAcc').append(buildSection(sec));
  buildCharacters();
  showTab('body');

  body.addEventListener('click', e => {
    const b = e.target.closest('button[data-key]'); if (b) { edit({ [b.dataset.key]: JSON.parse(b.dataset.val) }); return; }
    const c = e.target.closest('button[data-preset]');
    if (c) apply({ ...presetSpec(PRESETS.find(p => p.id === +c.dataset.preset)), scale: player.spec.scale });
  });
  body.addEventListener('input', e => {
    const t = e.target; if (t.tagName !== 'INPUT' || !t.dataset.key) return;
    edit({ [t.dataset.key]: t.type === 'range' ? +t.value : t.value });
  });
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  document.querySelectorAll('[data-frame]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-frame]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (preview) preview.setFrame(b.dataset.frame);
  });
  $('crRandom').onclick = () => apply(randomPlayerSpec(player.spec));
  $('crReset').onclick = () => apply(DEFAULT_SPEC);
  $('crDone').onclick = close;
  $('fpCustomize').onclick = open;
  addEventListener('keydown', e => {
    if (!ctl.active || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT' || e.key.toLowerCase() !== 'o') return;
    if (ctl.menu === close) close(); else open();
  });
}

export { initCreator };
