import { $ } from '../ui/dom.js';
import { careItem, careKey, careLimb, careTarget, inspectPerson, inspecting, setCareLimb } from '../net/care.js';
import { player } from './player.js';
import { limbOutText, limbReport, limbSummary } from './limb-health.js';

// The body figure in first and third person: one per person, each part coloured by how much health is left (limb-health.js). It shows you, and the
// patient: the person you inspect (the "Inspect" button), or the one you face while a bandage or first-aid box is picked. While inspecting, click a
// part on the patient's figure to choose what to treat, then hold E (or the Treat button). The page only reads `mechanics.health` as the server sent
// it; it is drawn from the 0.2 s prompt tick, nothing is polled. A part that has just been hit flashes (see flashLimbs, called from player/hit-fx.js).

// Seen from behind, so the character's left side is on the left of the figure. Arms and legs are round-ended strokes, the rest filled shapes.
const SHAPES = `
  <rect class="neck" x="45" y="26" width="10" height="11" rx="4"/>
  <circle class="limb" data-limb="head" cx="50" cy="16" r="11.5"/>
  <rect class="limb" data-limb="body" x="32" y="34" width="36" height="63" rx="15"/>
  <path class="limb cap" data-limb="leftArm" d="M26 46 L21 92"/>
  <path class="limb cap" data-limb="rightArm" d="M74 46 L79 92"/>
  <path class="limb cap" data-limb="leftLeg" d="M42.5 102 L41.5 175"/>
  <path class="limb cap" data-limb="rightLeg" d="M57.5 102 L58.5 175"/>
  <g class="marks" aria-hidden="true">
    <text data-mark="head" x="50" y="20.5">×</text><text data-mark="body" x="50" y="70">×</text>
    <text data-mark="leftArm" x="23.5" y="73">×</text><text data-mark="rightArm" x="76.5" y="73">×</text>
    <text data-mark="leftLeg" x="42" y="143">×</text><text data-mark="rightLeg" x="58" y="143">×</text>
  </g>`;
const figures = {};

function build(key) {
  const wrap = document.createElement('div');
  wrap.className = 'limb-fig'; wrap.dataset.fig = key;
  wrap.innerHTML = `<div class="limb-name"></div><svg viewBox="0 0 100 190" aria-hidden="true">${SHAPES}</svg>
    <div class="limb-bar" aria-hidden="true"><i></i></div><div class="limb-out"></div>`;
  for (const n of wrap.querySelectorAll('.limb')) n.dataset.level = 'ok';
  if (key === 'patient') {
    const tools = document.createElement('div');
    tools.className = 'limb-tools'; tools.hidden = true;
    tools.innerHTML = '<div class="limb-pick"></div><button class="btn" type="button" data-act="treat">Treat</button><button class="btn" type="button" data-act="close">Done</button>';
    wrap.append(tools);
    wrap.querySelector('svg').addEventListener('click', e => {
      const limb = e.target.closest?.('[data-limb]')?.dataset.limb;
      if (limb && inspecting() !== null) setCareLimb(careLimb() === limb ? null : limb);
      updateLimbHud();
    });
    tools.querySelector('[data-act="close"]').onclick = () => { inspectPerson(null); updateLimbHud(); };
    const treat = tools.querySelector('[data-act="treat"]');
    treat.addEventListener('pointerdown', e => { e.preventDefault(); careKey(true); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) treat.addEventListener(ev, () => careKey(false));
  }
  $('limbHud').append(wrap);
  return wrap;
}

const LIMB_TITLE = { head: 'head', body: 'body', leftArm: 'left arm', rightArm: 'right arm', leftLeg: 'left leg', rightLeg: 'right leg' };

function paint(key, title, person) {
  const report = limbReport(person?.mechanics?.health);
  let fig = figures[key];
  if (!report) { if (fig) fig.hidden = true; return null; }
  fig ??= figures[key] = build(key);
  fig.hidden = false;
  const name = fig.querySelector('.limb-name');
  if (name.textContent !== title) name.textContent = title;
  const chosen = key === 'patient' ? careLimb() : null;
  for (const r of report) {
    const node = fig.querySelector(`[data-limb="${r.limb}"]`);
    if (node.dataset.level !== r.level) node.dataset.level = r.level;
    node.classList.toggle('chosen', r.limb === chosen);
    fig.querySelector(`[data-mark="${r.limb}"]`).style.display = r.level === 'out' ? 'block' : 'none';
  }
  const hp = report.reduce((a, r) => a + r.hp, 0), max = report.reduce((a, r) => a + r.max, 0), share = max ? hp / max : 1;
  const bar = fig.querySelector('.limb-bar i');
  bar.style.width = `${Math.round(share * 100)}%`;
  bar.dataset.level = share > .6 ? 'ok' : share > .3 ? 'hurt' : 'critical';
  const out = limbOutText(report);
  const outNode = fig.querySelector('.limb-out');
  if (outNode.textContent !== out) outNode.textContent = out;
  fig.setAttribute('role', 'group');
  fig.setAttribute('aria-label', `${title}: ${limbSummary(report)}`);
  return fig;
}

/** Make the parts that were just hit on your own figure flash (`parts` is { limb: lost }). */
export function flashLimbs(parts) {
  const fig = figures.self;
  if (!fig) return;
  for (const limb of Object.keys(parts)) {
    const node = fig.querySelector(`[data-limb="${limb}"]`);
    if (!node) continue;
    node.classList.remove('hit');
    void node.getBoundingClientRect(); // (so the animation starts again if it is already running)
    node.classList.add('hit');
    node.addEventListener('animationend', e => { if (e.animationName === 'limbHit') node.classList.remove('hit'); });
  }
}

/** Redraw from the latest snapshot (first or third person). Hides itself when there is nothing to show. */
export function updateLimbHud() {
  const me = player.person;
  const looking = inspecting() !== null;
  const patient = me && (looking || careItem()) ? careTarget() : null;
  const self = paint('self', 'You', me);
  const fig = paint('patient', patient && patient !== me ? patient.name : '', patient && patient !== me ? patient : null);
  if (fig) {
    const tools = fig.querySelector('.limb-tools');
    const active = looking && patient !== null;
    tools.hidden = !active;
    fig.classList.toggle('inspecting', active);
    if (active) {
      const chosen = careLimb();
      const pick = tools.querySelector('.limb-pick');
      const text = chosen ? `Treat: ${LIMB_TITLE[chosen]}` : 'Click a body part';
      if (pick.textContent !== text) pick.textContent = text;
      tools.querySelector('[data-act="treat"]').hidden = !careItem();
    }
  }
  inspectButton(me, patient, looking);
  $('limbHud').hidden = !self;
}

// "Inspect <name>" shows while another player is in reach and in front of you; while inspecting it ends the inspection.
let inspectWired = false;
function inspectButton(me, patient, looking) {
  const b = $('fpInspect');
  if (!inspectWired) {
    inspectWired = true;
    b.onclick = () => {
      if (inspecting() !== null) inspectPerson(null);
      else { const t = careTarget(); if (t && t !== player.person) inspectPerson(t.id); }
      updateLimbHud();
    };
  }
  const other = me && !looking ? careTarget() : patient;
  const show = !!other && other !== me && !!player.online;
  b.hidden = !show;
  if (show) {
    const text = looking ? 'Stop inspecting' : `Inspect ${other.name}`;
    if (b.textContent !== text) b.textContent = text;
  }
}

export function hideLimbHud() { $('limbHud').hidden = true; }
