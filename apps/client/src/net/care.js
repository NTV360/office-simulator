import { CARE_REACH, LIMB_MAX_HP, angDiff, medicalHealSeconds, mostHurtLimb, people } from '@office/shared';
import { ctl } from '../player/control.js';
import { player } from '../player/player.js';

// Timed care: pick a bandage or first-aid box on the hotbar (press its number, or click it), then HOLD E. It heals the person you face within
// reach, or yourself, after 3 seconds (bandage) or 5 (first-aid box): the bar fills while the server counts. Letting go, walking off, or a hit
// ends it and nothing is used up. The page only asks and shows; the server holds the clock and every rule (apps/server/src/play/medical-care.ts).

const LIMB_LABEL = { head: 'head', body: 'body', leftArm: 'left arm', rightArm: 'right arm', leftLeg: 'left leg', rightLeg: 'right leg' };
const state = { send: null, revision: () => 0, say: () => {}, item: null, held: false, active: null, inspect: null, limb: null };
let bar = null, fill = null, label = null, frame = 0;

/** The page's way to talk to the server, to read the inventory revision, and to say something to the player. */
export function initCare({ send, revision, say }) {
  state.send = send; state.revision = revision; state.say = say;
  bar = document.createElement('div');
  bar.id = 'careBar'; bar.hidden = true; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Care in progress');
  label = document.createElement('span');
  const track = document.createElement('div'); track.className = 'care-track';
  fill = document.createElement('div'); fill.className = 'care-fill';
  track.append(fill); bar.append(label, track);
  document.body.append(bar);
}

/** The medical item picked on the hotbar ({ id, type }), or null: anything else picks nothing. */
export function selectCareItem(item) {
  state.item = item && medicalHealSeconds(item.type) !== null ? { id: item.id, type: item.type } : null;
  if (!state.item && state.active) stop();
}
export const careItem = () => state.item;

/** Look over somebody (their id, or null to stop): their body figure opens, and a limb clicked on it is what the care treats. */
export function inspectPerson(id) {
  if (state.active) return;
  state.inspect = id ?? null; state.limb = null;
}
export const inspecting = () => state.inspect;
export const careLimb = () => state.limb;
/** Choose the body part to treat (a limb name), or null for the most-hurt one. */
export function setCareLimb(limb) { if (!state.active) state.limb = limb; }

/** The person being inspected, while they are still within reach; otherwise the inspection ends. */
function inspected() {
  const me = player.person;
  const p = state.inspect === null ? null : people.find(q => q.id === state.inspect);
  if (p && me && p !== me && p.controller === 'account' && Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z) <= CARE_REACH + .3) return p;
  if (state.inspect !== null && !state.active) { state.inspect = null; state.limb = null; }
  return state.inspect !== null ? p ?? null : null;
}

/** Who E would care for: the person being inspected, else the other player you face within reach, else yourself. */
export function careTarget() {
  const me = player.person;
  if (!me) return null;
  const looked = inspected();
  if (looked) return looked;
  const facing = ctl.mode === 'fp' ? ctl.yaw : me.face;
  let best = null, bestD = Infinity;
  for (const p of people) {
    if (p.id === me.id || p.controller !== 'account' || !(p.mechanics?.health?.body > 0)) continue;
    const dx = p.pos.x - me.pos.x, dz = p.pos.z - me.pos.z, d = Math.hypot(dx, dz);
    if (d > CARE_REACH || Math.abs(angDiff(facing, Math.atan2(dx, dz))) > .7) continue;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** What to tell the player while a medical item is picked and nothing else is aimed at. */
export function careHint() {
  if (!state.item) return '';
  const target = careTarget();
  const seconds = medicalHealSeconds(state.item.type);
  const what = state.item.type === 'bandage' ? 'bandage' : 'first-aid box';
  const part = state.limb ? ` (${LIMB_LABEL[state.limb]})` : '';
  return `Hold E: use the ${what} on ${target ? target.name : 'yourself'}${part} (${seconds} s)`;
}

/** E went down (true) or up (false). Returns whether care took the key (so nothing else should act on it). */
export function careKey(down) {
  if (!down) {
    const had = state.held;
    state.held = false;
    if (had || state.active) stop(true);
    return had;
  }
  const me = player.person;
  if (!state.item || !state.send || !me || !ctl.active || player.sitting || state.held) return false;
  const target = careTarget();
  // nothing to heal (as far as the page can tell): E means what it always meant, sitting down or standing up included
  const health = (target ?? me).mechanics?.health;
  const chosen = state.limb;
  if (health && (chosen ? health[chosen] >= LIMB_MAX_HP[chosen] : mostHurtLimb(health) === null)) return false;
  state.held = true;
  state.send({ type: 'inventory', action: 'care', itemId: state.item.id, revision: state.revision(), ...(target ? { target: target.id } : {}), ...(state.limb ? { limb: state.limb } : {}) });
  return true;
}

const REASONS = {
  moved: 'You moved, so the care stopped.',
  range: 'The patient moved out of reach.',
  hit: 'Somebody was hit, so the care stopped.',
  hurt: 'Somebody was knocked down, so the care stopped.',
  gone: 'The care could not go on.',
  unhurt: 'There is nothing to heal there.',
  'not-medical': 'That is not something to heal with.',
  hands: 'You cannot use your hands right now.',
  target: 'You cannot treat that person.',
  'too-far': 'Step closer to the patient.',
  down: 'The patient is on the ground; wait a moment.',
  busy: 'You are already giving care.',
};

/** The server's word on the care (`start:3`, `done`, `cancel:why`). */
export function careNote(text) {
  if (text.startsWith('start:')) {
    const seconds = Number(text.slice(6));
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    state.active = { start: performance.now(), seconds };
    label.textContent = state.item?.type === 'first-aid-box' ? 'Using the first-aid box…' : 'Using the bandage…';
    bar.hidden = false; fill.style.width = '0%';
    cancelAnimationFrame(frame); frame = requestAnimationFrame(draw);
    return;
  }
  const wasActive = !!state.active;
  hide();
  state.active = null;
  if (text === 'done') { state.say('Treated.'); state.held = false; return; }
  const why = text.startsWith('cancel:') ? text.slice(7) : '';
  if (why && why !== 'released' && (wasActive || REASONS[why])) state.say(REASONS[why] ?? 'The care stopped.');
}

function stop(tell) {
  if (tell && state.send) state.send({ type: 'inventory', action: 'care-stop', revision: state.revision() });
  state.active = null;
  hide();
}
function hide() { if (bar) bar.hidden = true; cancelAnimationFrame(frame); }
function draw() {
  if (!state.active) return;
  const f = Math.min(1, (performance.now() - state.active.start) / (state.active.seconds * 1000));
  fill.style.width = `${Math.round(f * 100)}%`;
  bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  frame = requestAnimationFrame(draw);
}
