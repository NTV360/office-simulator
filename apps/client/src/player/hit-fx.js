import { $ } from '../ui/dom.js';
import { conditionMessage, damageBetween, flashStrength } from './damage-feedback.js';
import { flashLimbs } from './limb-hud.js';
import { limbReport } from './limb-health.js';

// Telling you that you were hurt: a red flash round the edges of the screen when you are hit (the harder the hit, the stronger and longer), a slow
// red heartbeat at the edges while something of you is almost broken or broken, the hit part flashing on your body figure, and a sentence at the
// bottom saying what is broken or nearly so. It only reads your health as the server sent it (the rules are in player/damage-feedback.js).
// Called every frame with your own person; it does nothing until something changes.

const state = { who: null, health: null, key: '', flashes: 0, lastStrength: 0 };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function flash(strength) {
  const el = $('hitVignette');
  if (!el?.animate) return null;
  const s = Math.max(0, Math.min(1, strength));
  return el.animate(calm()
    ? [{ opacity: s * .7 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: s, offset: .1 }, { opacity: s * .35, offset: .32 }, { opacity: s * .85, offset: .46 }, { opacity: 0 }], // (a double beat, like a heart)
  { duration: calm() ? 700 : 650 + 750 * s, easing: 'ease-out' });
}

/** Look at your own person's health: flash if you lost some since last time, and keep the message and the edge glow right. */
export function observeOwnHealth(person) {
  const health = person?.mechanics?.health;
  if (!health) return;
  if (state.who !== person.id) Object.assign(state, { who: person.id, health: null, key: '' }); // (a different person: no flash for what was already so)
  const damage = damageBetween(state.health, health);
  state.health = { ...health };
  if (damage) {
    state.flashes++; state.lastStrength = flashStrength(damage);
    state.lastAnimation = flash(state.lastStrength);
    flashLimbs(damage.parts);
  }
  const report = limbReport(health);
  const message = conditionMessage(report);
  const key = message ? `${message.tone}|${message.text}` : '';
  if (key !== state.key) {
    state.key = key;
    const bar = $('fpCondition'), glow = $('lowVignette');
    if (bar) {
      bar.hidden = !message;
      if (message) { bar.textContent = message.text; bar.dataset.tone = message.tone; }
    }
    if (glow) { if (message) glow.dataset.tone = message.tone; else delete glow.dataset.tone; }
  }
  if (window.__sim) window.__sim.hitFx = state; // (for the browser checks)
}
