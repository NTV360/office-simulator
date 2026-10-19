import { describe, expect, it } from 'vitest';
import { AIM, aimedLimb, eyeHeightOf, heightOf, sanePitch, type AimInput } from './aim';

// The attacker stands at the origin looking along +z (face 0); the target stands in front of them facing back (face PI).
const base: AimInput = {
  kind: 'punch', attackerPosture: 'standing', attackerCrouch: 0, pitch: 0, attackerFace: 0,
  targetFace: Math.PI, targetPosture: 'standing', targetCrouch: 0, dx: 0, dz: 1,
};
const at = (over: Partial<AimInput>) => aimedLimb({ ...base, ...over });
const down = (degrees: number) => -degrees * Math.PI / 180;

describe('which part an attack lands on, from where the attacker looks', () => {
  it('looking straight at a person of the same height hits the head', () => {
    expect(at({})).toBe('head');
  });
  it('looking down at the chest hits the body, and further down the legs', () => {
    expect(at({ pitch: down(20) })).toBe('body');
    expect(at({ pitch: down(25) })).toBe('body');
    expect(at({ pitch: down(35) })).toMatch(/Leg$/); // 1.3 - tan(35 deg) = 0.6 m: below the knees' share of the height
    expect(at({ pitch: down(60) })).toMatch(/Leg$/);
  });
  it('the same look lands lower on a person who is further away', () => {
    expect(at({ pitch: down(15), dz: 1 })).toBe('body');
    expect(at({ pitch: down(15), dz: 3 })).toMatch(/Leg$/); // 1.3 - 3 * tan(15 deg) = 0.5 m
  });
  it('a line off to one side of the middle hits that side\'s arm, as the target sees it', () => {
    // the target faces the attacker, so the attacker's left is the target's right
    expect(at({ pitch: down(20), dx: .2 })).toBe('rightArm'); // the middle of them is to the attacker's right, so the line is on their right
    expect(at({ pitch: down(20), dx: -.2 })).toBe('leftArm');
    expect(at({ pitch: down(20), dx: .1 })).toBe('body');
  });
  it('turns the sides round for a target who faces away', () => {
    expect(at({ pitch: down(20), dx: .2, targetFace: 0 })).toBe('leftArm');
    expect(at({ pitch: down(20), dx: -.2, targetFace: 0 })).toBe('rightArm');
  });
  it('low down, the line to one side hits that leg', () => {
    expect(at({ pitch: down(60), dx: .2 })).toBe('rightLeg');
    expect(at({ pitch: down(60), dx: -.2 })).toBe('leftLeg');
  });
  it('a kick cannot reach the head', () => {
    expect(at({ kind: 'kick' })).toBe('body');
    expect(at({ kind: 'kick', pitch: down(60) })).toMatch(/Leg/);
  });
  it('a person on the ground is just a body', () => {
    for (const targetPosture of ['prone', 'ragdoll', 'recovering'] as const) expect(at({ targetPosture, pitch: down(60), dx: .3 })).toBe('body');
  });
  it('a crouching target is shorter, so the same look is higher on them', () => {
    expect(at({ pitch: down(20), targetPosture: 'crouching', targetCrouch: 1 })).toBe('head');
    expect(heightOf('crouching', 1)).toBeCloseTo(AIM.heightStanding * .55);
    expect(heightOf('standing', 0)).toBe(AIM.heightStanding);
  });
  it('a crouching attacker looks up at a standing target', () => {
    expect(eyeHeightOf('crouching', 1)).toBeCloseTo(AIM.eyeStanding - AIM.eyeDropCrouch);
    expect(at({ attackerPosture: 'crouching', attackerCrouch: 1, pitch: down(8) })).toBe('body');
  });
  it('does not believe a missing or absurd look angle', () => {
    expect(sanePitch(undefined)).toBe(0);
    expect(sanePitch(NaN)).toBe(0);
    expect(sanePitch(99)).toBe(AIM.maxPitch);
    expect(sanePitch(-99)).toBe(-AIM.maxPitch);
    expect(at({ pitch: undefined })).toBe(at({ pitch: 0 }));
    expect(at({ pitch: Infinity })).toBe(at({ pitch: AIM.maxPitch }));
  });
  it('always answers with one of the six parts, whatever it is given', () => {
    const six = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
    for (const pitch of [-2, -1, -.5, 0, .5, 1, 2, NaN]) for (const dx of [-1, -.3, 0, .3, 1]) for (const dz of [.1, 1, 3]) for (const targetFace of [0, 1, 2, 3]) {
      expect(six).toContain(at({ pitch, dx, dz, targetFace }));
    }
  });
});
