import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module
import { ATTACK_TOTAL, HOLD_TIME, RECOVER_TIME, STRIKE_TIME, swing, swingPose, trackAttack } from './attack-anim.js';

describe('the punch and kick timeline', () => {
  it('draws back while charging, and further the longer it is held', () => {
    expect(swing(0, 0, null)).toBeCloseTo(0);
    const quick = swing(.1, 0, null), full = swing(.1, 1, null);
    expect(quick).toBeLessThan(-.4); // even a tap draws back
    expect(full).toBeCloseTo(-1);
    expect(full).toBeLessThan(quick);
    expect(swing(.5, 1, null)).toBeCloseTo(-1); // and stays there
  });
  it('strikes fast: fully stretched 70 ms after the release, from the drawn-back position', () => {
    expect(swing(.1, 1, 0)).toBeCloseTo(-1);
    expect(swing(.1, 1, STRIKE_TIME / 2)).toBeGreaterThan(0); // already past standing halfway through the strike
    expect(swing(.1, 1, STRIKE_TIME)).toBeCloseTo(1);
    expect(swing(0, 0, STRIKE_TIME)).toBeCloseTo(1);
  });
  it('holds, recovers to standing, then is over before the server\'s 350 ms cooldown ends', () => {
    expect(swing(.1, 1, STRIKE_TIME + HOLD_TIME / 2)).toBe(1);
    const mid = swing(.1, 1, STRIKE_TIME + HOLD_TIME + RECOVER_TIME / 2);
    expect(mid).toBeGreaterThan(.2); expect(mid).toBeLessThan(.8);
    expect(swing(.1, 1, ATTACK_TOTAL - .001)).toBeCloseTo(0, 1);
    expect(swing(.1, 1, ATTACK_TOTAL + .001)).toBeNull();
    expect(ATTACK_TOTAL).toBeLessThan(.35);
  });
  it('puts the arm forward for a punch on the side that punches, and mirrors it for the left', () => {
    const right = swingPose('punch', 'right', 1), left = swingPose('punch', 'left', 1);
    expect(right.rShX).toBeLessThan(-1.4); expect(right.lShX).toBeGreaterThan(-1);
    expect(left.lShX).toBeLessThan(-1.4); expect(left.rShX).toBeGreaterThan(-1);
    expect(left.twist).toBeCloseTo(-right.twist); // the body turns the other way
    expect(swingPose('punch', 'right', -1).rShX).toBeGreaterThan(.5); // drawn back: the arm goes behind
  });
  it('raises the kicking leg and holds the arms out for balance', () => {
    const right = swingPose('kick', 'right', 1), left = swingPose('kick', 'left', 1);
    expect(right.rHip).toBeLessThan(-1.2); expect(left.lHip).toBeLessThan(-1.2);
    expect(right.rShZ).toBeLessThan(0); expect(right.lShZ).toBeGreaterThan(0); // the right arm goes out to the right, the left to the left
    expect(left.lShZ).toBeGreaterThan(0); expect(left.rShZ).toBeLessThan(0);
  });
  it('changes nothing when finished or for other attacks', () => {
    expect(swingPose('punch', 'right', null)).toEqual({});
    expect(swingPose('bash', 'right', 1)).toEqual({});
  });
});

describe('following the server\'s attack for the animation', () => {
  const atk = (phase: string, sequence = 1, kind = 'punch') => ({ kind, side: 'right', phase, sequence, charge: .5 });
  it('starts a swing on a new sequence number, releases it, and ends it after its recovery', () => {
    const p: any = {};
    trackAttack(p, atk('charging'), 10);
    expect(p._atk).toMatchObject({ seq: 1, rel: null });
    trackAttack(p, atk('active'), 10.2);
    expect(p._atk.rel).toBe(10.2);
    trackAttack(p, null, 10.2 + ATTACK_TOTAL - .01);
    expect(p._atk).not.toBeNull(); // the server has long cleared it, the recovery still plays
    trackAttack(p, null, 10.2 + ATTACK_TOTAL + .01);
    expect(p._atk).toBeNull();
  });
  it('never starts a finished swing again while the server still reports its sequence (this froze the page)', () => {
    const p: any = {};
    trackAttack(p, atk('charging'), 0);
    trackAttack(p, atk('active'), .1);
    trackAttack(p, atk('cooldown'), .1 + ATTACK_TOTAL + .02);
    expect(p._atk).toBeNull();
    for (let t = 1; t < 6; t++) trackAttack(p, atk('cooldown'), .1 + ATTACK_TOTAL + .02 + t * .05); // still reported, snapshot after snapshot
    expect(p._atk).toBeNull();
    trackAttack(p, atk('charging', 2), 2); // the next attack is a new sequence and does start
    expect(p._atk).toMatchObject({ seq: 2 });
  });
  it('finishes a swing the server drops before a release was seen (knocked down, cancelled)', () => {
    const p: any = {};
    trackAttack(p, atk('charging'), 0);
    trackAttack(p, null, .3);
    expect(p._atk.rel).toBe(.3);
    trackAttack(p, null, .3 + ATTACK_TOTAL + .01);
    expect(p._atk).toBeNull();
  });
  it('ignores bashes and an absent attack', () => {
    const p: any = {};
    trackAttack(p, atk('charging', 1, 'bash'), 0);
    trackAttack(p, null, 1);
    expect(p._atk ?? null).toBeNull();
  });
});