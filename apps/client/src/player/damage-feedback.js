// Pure rules for telling a player they were hurt (no DOM, so it is unit tested): what changed since last time, how strong the red flash is, and the
// sentence at the bottom of the screen about what is broken or nearly broken. The body figure's colours are player/limb-health.js.

import { LIMBS } from './limb-health.js';

const PLAIN = { head: 'head', body: 'body', leftArm: 'left arm', rightArm: 'right arm', leftLeg: 'left leg', rightLeg: 'right leg' };

/**
 * What a new health reading lost compared with the one before: { total, parts: { limb: lost }, newlyOut: [limb] } or null when nothing was lost
 * (healing, no change, or no earlier reading, such as the first one after joining: that is not a hit).
 */
export function damageBetween(before, after) {
  if (!before || !after) return null;
  const parts = {}, newlyOut = [];
  let total = 0;
  for (const limb of LIMBS) {
    const was = Number(before[limb]), now = Number(after[limb]);
    if (!Number.isFinite(was) || !Number.isFinite(now)) continue;
    const lost = was - now;
    if (lost > 1e-6) { parts[limb] = lost; total += lost; if (now <= 0 && was > 0) newlyOut.push(limb); }
  }
  return total > 0 ? { total, parts, newlyOut } : null;
}

/** How strong the red flash is, from 0.25 (a light punch) to 1 (a big hit or a part breaking). */
export function flashStrength(damage) {
  if (!damage) return 0;
  const base = .25 + .75 * Math.min(1, damage.total / 30);
  return Math.min(1, damage.newlyOut.length ? Math.max(base, .9) : base);
}

const list = names => names.length === 2 ? `${names[0]} and ${names[1]}` : names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
/** "left arm" or "both arms" for a set of limbs. */
function say(limbs) {
  const has = l => limbs.includes(l);
  const names = [];
  const pair = (l, r, both, one) => { if (has(l) && has(r)) names.push(both); else if (has(l)) names.push(one(l)); else if (has(r)) names.push(one(r)); };
  if (has('head')) names.push('head');
  if (has('body')) names.push('body');
  pair('leftArm', 'rightArm', 'both arms', l => PLAIN[l]);
  pair('leftLeg', 'rightLeg', 'both legs', l => PLAIN[l]);
  return names;
}
const subject = names => names.length === 1 && names[0].startsWith('both') ? `Both your ${names[0].slice(5)}` : `Your ${list(names)}`;
const plural = names => names.length > 1 || names[0]?.startsWith('both');

/** What a person can no longer do because of the parts at 0 (only what the game really does: see docs/CHARACTER-MECHANICS.md). */
function consequence(out) {
  if (out.includes('body')) return "you can't move or use your hands";
  const legs = out.some(l => l.endsWith('Leg')), arms = out.includes('leftArm') && out.includes('rightArm');
  if (legs && arms) return "you can't walk or use your hands";
  if (legs) return "you can't walk";
  if (arms) return "you can't use your hands";
  return '';
}

/**
 * The sentence for the bottom of the screen, from a limb report (limb-health.js limbReport): { text, tone } or null when nothing needs saying.
 * tone is 'warn' (almost broken), 'broken' (something no longer works) or 'severe' (the whole body is in a bad way).
 */
export function conditionMessage(report) {
  if (!report) return null;
  const out = report.filter(r => r.level === 'out').map(r => r.limb);
  const critical = report.filter(r => r.level === 'critical').map(r => r.limb);
  const hp = report.reduce((a, r) => a + r.hp, 0), max = report.reduce((a, r) => a + r.max, 0);
  if (critical.length + out.length >= 4 || (out.length + critical.length > 0 && hp / max < .3)) {
    return { text: out.length ? 'Your whole body is severely damaged and parts are broken. Get treatment now.' : 'Your whole body is severely damaged. Get treatment now.', tone: 'severe' };
  }
  const clauses = [];
  if (out.length) {
    const names = say(out), why = consequence(out);
    clauses.push(`${subject(names)} ${plural(names) ? 'are' : 'is'} broken${why ? `, ${why}` : ''}.`);
  }
  if (critical.length) {
    const names = say(critical);
    clauses.push(`${subject(names)} ${plural(names) ? 'are' : 'is'} almost broken.`);
  }
  if (!clauses.length) return null;
  const all = say([...out, ...critical]);
  clauses.push(`Treat ${plural(all) ? 'them' : 'it'} immediately.`);
  return { text: clauses.join(' '), tone: out.length ? 'broken' : 'warn' };
}
