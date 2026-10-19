import { LIMB_MAX_HP } from '@office/shared';

// Pure rules for the body-part display (no DOM): how hurt a limb is, what to call it, what the person can no longer do.

export const LIMBS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const NAMES = { head: 'Head', body: 'Body', leftArm: 'Left arm', rightArm: 'Right arm', leftLeg: 'Left leg', rightLeg: 'Right leg' };

/** 'ok' (full health: any damage shows), 'hurt' (over 35% left), 'critical' (about to fail) or 'out' (0: it no longer works). */
export function limbLevel(hp, max) {
  if (!(max > 0) || !Number.isFinite(hp)) return 'ok';
  if (hp <= 0) return 'out';
  if (hp >= max) return 'ok';
  return hp / max > .35 ? 'hurt' : 'critical';
}

/** The six limbs of a `mechanics.health` as [{ limb, name, hp, max, level }], or null when there is no health to show. */
export function limbReport(health) {
  if (!health) return null;
  return LIMBS.map(limb => {
    const max = LIMB_MAX_HP[limb], hp = Math.max(0, Math.min(max, Number(health[limb]) || 0));
    return { limb, name: NAMES[limb], hp, max, level: limbLevel(hp, max) };
  });
}

/** What no longer works, e.g. "Left arm out", or '' when everything works. */
export function limbOutText(report) {
  if (!report) return '';
  return report.filter(r => r.level === 'out').map(r => `${r.name} out`).join(' · ');
}

/** A short text for assistive tech: every limb that is not fully healthy, or "No injuries". */
export function limbSummary(report) {
  if (!report) return '';
  const hurt = report.filter(r => r.hp < r.max).map(r => `${r.name} ${r.hp} of ${r.max}`);
  return hurt.length ? hurt.join(', ') : 'No injuries';
}
