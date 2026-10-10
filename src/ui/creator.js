import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Character } from '../character/pack/characters.js';
import { CHARACTER_SIZES, fitHead } from '../character/rig.js';
import { DESK_ISLANDS, deskSeat, deskSeats } from '../config/desks.js';
import { seededRandom } from '../core/util.js';
import { TYPES, normalizeSpec, presetList, randomSpec, specOptions } from '../character/spec.js';
import { moveToDesk, restylePerson, seatById } from '../people/factory.js';
import { HAZEL_NAME } from '../people/hazel.js';
import { employeeById, fullName, jobTitle, roster, simRole } from '../people/roster.js';
import { saveCharacter } from '../persistence/store.js';
import { fillAvatar } from './avatar.js';
import { player, savePlayerSpec, setPlayerSpec } from '../player/player.js';
import { addLog, people } from '../sim/state.js';
import { $ } from './dom.js';

/* ================= Character lab ================= */
// Edit an employee's character: click someone in the office and press "Edit character", or search for them
// here. Edits go to a draft spec and a desk choice; Save stores both in character_information for that
// employee (through the API), restyles them and moves them to that desk in the office. Without a staff list (API unavailable) it edits the player's own look.
// The preview has its own small renderer, made the first time the lab opens.
const creator = { open: false, draft: null, view: null, keepStyle: false, spin: false, stage: null, target: null, desk: null, deskIsland: null, folds: new Set(['employee', 'desk']) };
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
// Open the lab, editing the employee with this user id (or nobody yet: search for them).
function openCreator(userId = null) {
  if (creator.open) return;
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  creator.open = true; $('creator').hidden = false;
  creator.target = employeeById(userId) ? userId : null;
  creator.draft = roster.list ? lookOf(creator.target) : clone(player.spec);
  creator.desk = deskOf(creator.target); creator.deskIsland = null;
  if (!creator.stage) creator.stage = makeStage();
  creator.stage.resize(); creator.stage.clock.getDelta();
  rebuild();
  loop();
  (creator.target || !roster.list ? $('creatorSave') : $('creatorSearch')).focus();
}
function closeCreator(save) {
  if (!creator.open) return;
  if (save) {
    const e = employeeById(creator.target);
    if (e) saveEmployee(e, normalizeSpec(creator.draft), creator.desk);
    else if (!roster.list) { setPlayerSpec(creator.draft); savePlayerSpec(); addLog('You changed your look'); }
  }
  creator.open = false; $('creator').hidden = true;
  cancelAnimationFrame(creator.stage.raf);
}

// The look an employee has now: as drawn in the office, else saved, else the generated one they'd get.
function lookOf(userId) {
  const e = employeeById(userId); if (!e) return clone(player.spec);
  const p = people.find(q => q.userId === userId);
  return clone(p?.spec ?? e.character ?? randomSpec(simRole(e.department), seededRandom(e.userId)));
}
// The desk an employee chose, else the one they sit at now (null: not in the office, no choice yet).
function deskOf(userId) { return employeeById(userId)?.desk ?? people.find(q => q.userId === userId)?.seat.deskId ?? null; }
// Store the look and desk in character_information, and show them in the office right away.
function saveEmployee(e, spec, desk) {
  const before = { character: e.character, desk: e.desk };
  e.character = spec; e.desk = desk;
  const p = people.find(q => q.userId === e.userId);
  if (p) { restylePerson(p, p.name === HAZEL_NAME ? normalizeSpec({ ...spec, angry: true }) : spec); if (desk) moveToDesk(p, seatById(desk)); }
  saveCharacter(e.userId, spec, desk).then(r => {
    if (r.ok) { addLog(`Saved ${e.firstName}'s character${desk ? ` (${seatById(desk)?.label ?? desk})` : ''}`); return; }
    Object.assign(e, before); // the office keeps the change until reload; the list goes back to what's stored
    addLog(`Couldn't save ${e.firstName}'s character: ${r.error ?? 'server error'}`);
  });
}

// ----- editing -----
function rebuild(refreshPanel = true) {
  const hero = creator.stage.hero;
  hero.set(creator.draft, true); fitHead(hero);
  creator.view = hero.resolved;
  const e = employeeById(creator.target);
  $('creatorTitle').textContent = e ? fullName(e) : roster.list ? 'Edit a character' : 'Your character';
  $('creatorWho').textContent = e ? `${jobTitle(e)} · ${STYLE_LABEL[creator.draft.type]}` : roster.list ? 'Search for an employee to start' : STYLE_LABEL[creator.draft.type];
  $('creatorSave').disabled = !!roster.list && !e;
  $('creatorSave').textContent = e ? `Save ${e.firstName}'s character` : 'Save';
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
  creator.draft = { ...clone(spec), type: creator.keepStyle ? creator.draft.type : spec.type };
  rebuild();
}
// Colour inputs fire continuously; redraw the character live and the panel only when the pick is final.
const live = fn => (value, isLive) => { fn(value); edited(); rebuild(!isLive); };

// "Employee": who is being edited, or a search to find them.
const MAX_MATCHES = 8;
function employeePicker() {
  const e = employeeById(creator.target);
  if (e) return fold('employee', 'Employee', fullName(e),
    el('div', { class: 'cl-me' },
      avatarOf(e),
      el('div', { class: 'cl-me-who' }, el('div', { class: 'cl-me-name' }, fullName(e)), el('div', { class: 'cl-note' }, jobTitle(e))),
      el('button', { type: 'button', class: 'btn sm', on: { click: () => { creator.target = null; rebuild(); $('creatorSearch').focus(); } } }, 'Change')));
  const results = el('div', { class: 'cl-matches', id: 'creatorMatches', role: 'listbox', 'aria-label': 'Matching employees' });
  const search = el('input', { type: 'search', id: 'creatorSearch', placeholder: 'Search an employee…', autocomplete: 'off', 'aria-label': 'Search an employee',
    on: { input: ev => showMatches(results, ev.target.value), keydown: ev => { if (ev.key === 'Enter') results.querySelector('button')?.click(); } } });
  return fold('employee', 'Employee', 'Pick an employee', search, results, el('div', { class: 'cl-note' }, 'Find the employee whose character you want to edit, or click them in the office.'));
}
// "Desk": where this employee sits. First pick a desk group (A-H, the HR office), then a seat in it, shown
// like cinema seats: the chairs on each side of the desk in their real order. Seats other employees chose
// can't be picked; department desks (the HR office) only by that department. Picking a seat someone sits
// at without having chosen it swaps them.
function seatState(e, s) {
  if (s.id === creator.desk) return 'mine';
  if (roster.list.some(o => o.desk === s.id && o.userId !== e.userId)) return 'taken';
  if (s.island.department && s.island.department !== e.department) return 'taken';
  const sitter = seatById(s.id)?.owner;
  return sitter && sitter.userId !== e.userId ? 'used' : 'free';
}
function deskPicker(e) {
  const seats = deskSeats(), cur = deskSeat(creator.desk);
  const islands = DESK_ISLANDS.filter(isl => !isl.department || isl.department === e.department || cur?.island === isl);
  const shown = islands.find(i => i.id === creator.deskIsland) ?? cur?.island ?? islands[0];
  creator.deskIsland = shown.id;
  const open = isl => seats.filter(s => s.island === isl && seatState(e, s) !== 'taken').length; // pickable: free, or a swap
  const groups = el('div', { class: 'cl-islands', role: 'tablist', 'aria-label': 'Desk group' }, islands.map(isl => el('button', {
    type: 'button', class: 'cl-isl', role: 'tab', 'aria-selected': String(isl === shown), title: isl.name,
    on: { click: () => { creator.deskIsland = isl.id; renderPanel(); } } }, el('b', {}, isl.department ? 'HR' : isl.id), el('span', {}, `${open(isl)} open`))));
  const row = side => el('div', { class: 'cl-seatrow' }, seats.filter(s => s.island === shown && s.py < shown.rect[1] === (side === 'top')).map(s =>
    el('button', { type: 'button', class: 'cl-seat', 'data-desk': s.id, role: 'radio', on: { click: () => pickDesk(e, s.id) } }, String(s.number))));
  const map = el('div', { class: 'cl-seatmap', id: 'creatorSeatMap', role: 'radiogroup', 'aria-label': shown.name },
    shown.sides.includes('top') ? row('top') : null, el('div', { class: 'cl-deskbar' }, shown.name), shown.sides.includes('bottom') ? row('bottom') : null);
  const legend = el('div', { class: 'cl-legend' }, [['mine', 'Selected'], ['free', 'Free'], ['used', 'Someone sits here (swaps)'], ['taken', 'Taken']].map(([c, t]) => el('span', {}, el('i', { class: 'cl-dot ' + c }), t)));
  const any = el('button', { type: 'button', class: 'btn sm', id: 'creatorAnyDesk', on: { click: () => pickDesk(e, null) } }, 'Any free desk');
  queueMicrotask(() => paintSeats(e));
  return fold('desk', 'Desk', el('span', { id: 'creatorDeskSum' }, cur ? cur.label : 'Any free desk'), groups, map, el('div', { class: 'cl-deskfoot' }, legend, any));
}
// Colour this group's seats for the employee and show the choice; called again after each pick.
function paintSeats(e) {
  const map = $('creatorSeatMap'); if (!map) return;
  for (const b of map.querySelectorAll('.cl-seat')) {
    const s = deskSeat(b.dataset.desk), state = seatState(e, s);
    const taken = roster.list.find(o => o.desk === s.id && o.userId !== e.userId), sitter = seatById(s.id)?.owner;
    b.className = 'cl-seat ' + state; b.disabled = state === 'taken'; b.setAttribute('aria-checked', String(state === 'mine'));
    const who = taken ? `${fullName(taken)}'s desk` : state === 'taken' ? `${s.island.department} only` : state === 'used' ? `${sitter.name} sits here` : state === 'mine' ? 'selected' : 'free';
    b.title = `${s.label} · ${who}`; b.setAttribute('aria-label', b.title);
  }
  const cur = deskSeat(creator.desk);
  $('creatorDeskSum').textContent = cur ? cur.label : 'Any free desk';
  $('creatorAnyDesk').setAttribute('aria-pressed', String(!creator.desk));
}
function pickDesk(e, id) { creator.desk = id; paintSeats(e); }

// Names that contain every typed word (first or last name, any order, any case).
function showMatches(box, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.replaceChildren(); return; }
  const found = roster.list.filter(e => { const n = fullName(e).toLowerCase(); return words.every(w => n.includes(w)); })
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  box.replaceChildren(...(found.length ? found.slice(0, MAX_MATCHES).map(e => el('button', { type: 'button', class: 'cl-match', role: 'option', on: { click: () => pickEmployee(e.userId) } },
    el('span', {}, fullName(e)), el('span', { class: 'cl-note' }, jobTitle(e))))
    : [el('div', { class: 'cl-note' }, 'No one by that name.')]),
    found.length > MAX_MATCHES ? el('div', { class: 'cl-note' }, `${found.length - MAX_MATCHES} more, keep typing…`) : null);
}
// An employee's avatar (photo or initials) on their shirt colour in the office.
function avatarOf(e) {
  const box = el('span', { class: 'avatar' }), p = people.find(q => q.userId === e.userId);
  fillAvatar(box, { name: fullName(e), photo: e.photo, color: p?.spec.top.color ?? '#4c5c6b' });
  return box;
}
function pickEmployee(userId) {
  creator.target = userId;
  creator.draft = lookOf(userId); creator.desk = deskOf(userId); creator.deskIsland = null;
  rebuild();
}

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
  const d = el('details', { class: 'cl-fold', open: creator.folds.has(key), on: { toggle: ev => { if (ev.target.open) creator.folds.add(key); else creator.folds.delete(key); } } },
    el('summary', {}, el('span', { class: 'fold-title' }, title), el('span', { class: 'fold-sum' }, summary)),
    el('div', { class: 'fold-body' }, ...content));
  return d;
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
  const d = creator.draft, view = creator.view, o = specOptions(d.type), notes = creator.stage.hero.notes ?? [];
  const presets = presetList();
  panel.replaceChildren(
    roster.list ? employeePicker() : null,
    employeeById(creator.target) ? deskPicker(employeeById(creator.target)) : null,
    fold('look', 'Style & presets', sum(STYLE_LABEL[d.type], presets.some(p => p.spec.name === d.name) ? d.name : 'Custom'),
      row('Style', segmented(TYPES, d.type, v => { d.type = v; rebuild(); })),
      notes.length ? el('div', { class: 'cl-note' }, `In this style: ${notes.join(' · ')}. Switch back to restore.`) : null,
      ...TYPES.map(type => el('div', { class: 'cl-stack' },
        el('div', { class: 'cl-lbl' }, `${STYLE_LABEL[type]} designs`),
        el('div', { class: 'cl-presets' }, presets.filter(p => p.type === type).map(p => chip(p.spec.name, d.name === p.spec.name && d.type === type, () => load(p.spec)))))),
      el('label', { class: 'cl-toggle' }, el('input', { type: 'checkbox', checked: creator.keepStyle, on: { change: e => { creator.keepStyle = e.target.checked; } } }), 'Load presets in the current style'),
      el('div', { class: 'cl-actions' },
        el('button', { type: 'button', class: 'btn sm', on: { click: () => { creator.draft = { ...randomSpec(), type: d.type, name: 'Random' }; rebuild(); } } }, 'Randomize'),
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
    d.accessories = [...keep, { type: name }];
  }
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
function updateJson() { const t = $('creatorJson'); if (t && t.readOnly) t.value = JSON.stringify(normalizeSpec(creator.draft), null, 2); }
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
    if (raw && typeof raw === 'object') { creator.draft = normalizeSpec({ type: creator.draft.type, ...raw }); rebuild(); } else updateJson();
  }, { once: true });
}

// ----- animation buttons -----
function renderClips() {
  const hero = creator.stage.hero, cur = hero.current?.getClip().name;
  $('creatorClips').replaceChildren(...hero.clipNames.map(n => el('button', { type: 'button', 'aria-pressed': String(n === cur), on: { click: () => { hero.play(n); renderClips(); } } }, n)));
}

function initCreator() {
  $('openCreator').onclick = () => openCreator();
  $('fpCreator').onclick = () => openCreator();
  $('creatorSave').onclick = () => closeCreator(true);
  $('creatorCancel').onclick = () => closeCreator(false);
  $('creatorBack').onclick = () => closeCreator(false);
  $('creatorSpin').onclick = e => { creator.spin = !creator.spin; e.currentTarget.setAttribute('aria-pressed', String(creator.spin)); };
  // keys typed in the lab must not steer the camera or the player
  $('creator').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') closeCreator(false); });
}

export { closeCreator, creator, initCreator, openCreator };
