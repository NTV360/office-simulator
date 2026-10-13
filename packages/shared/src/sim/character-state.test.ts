import { describe, expect, it } from 'vitest';
import {
  ATTACK, adjustCrouch, applyDamage, attackCharge, attackForce, bodyBroken, canMove, canUseHand,
  canUseHands, defaultCharacterMechanics, heal, headBroken, legsBroken, postureSpeedFactor,
} from './character-state';

describe('character mechanics state', () => {
  it('starts standing with full health and no active relationships', () => {
    const state = defaultCharacterMechanics();
    expect(state.posture).toBe('standing');
    expect(state.health).toEqual({ head: 40, body: 80, leftArm: 35, rightArm: 35, leftLeg: 45, rightLeg: 45 });
    expect(state.jumpHeld).toBe(false);
    expect(state.proneHeld).toBe(false);
    expect(state.attack).toBeNull();
    expect(state.holdTarget).toBeNull();
    expect(state.heldBy).toBeNull();
  });

  it('clamps and steps crouch input', () => {
    expect(adjustCrouch(0, 3)).toBeCloseTo(.3);
    expect(adjustCrouch(1, 1)).toBe(1);
    expect(adjustCrouch(0, -1)).toBe(0);
    expect(adjustCrouch(.4, Number.POSITIVE_INFINITY)).toBe(.4);
  });

  it('applies posture speed restrictions', () => {
    expect(postureSpeedFactor('standing', 0)).toBe(1);
    expect(postureSpeedFactor('crouching', 1)).toBe(.55);
    expect(postureSpeedFactor('prone', 0)).toBe(.25);
    expect(postureSpeedFactor('seated', 0)).toBe(0);
  });

  it('gates movement and hands from limb and posture state', () => {
    const state = defaultCharacterMechanics();
    expect(canMove(state)).toBe(true);
    expect(canUseHands(state)).toBe(true);
    expect(canUseHand(state, 'left')).toBe(true);
    state.health.leftLeg = 0;
    expect(legsBroken(state.health)).toBe(true);
    expect(canMove(state)).toBe(false);
    state.health.leftLeg = 1;
    state.health.leftArm = 0;
    expect(canUseHand(state, 'left')).toBe(false);
    expect(canUseHands(state)).toBe(true);
    state.health.rightArm = 0;
    expect(canUseHands(state)).toBe(false);
    state.health.body = 0;
    expect(bodyBroken(state.health)).toBe(true);
    expect(canMove(state)).toBe(false);
    expect(canUseHands(state)).toBe(false);
  });

  it('applies bounded damage and healing without mutating the source', () => {
    const original = defaultCharacterMechanics().health;
    const damaged = applyDamage(original, 'head', 100);
    expect(original.head).toBe(40);
    expect(damaged.head).toBe(0);
    expect(headBroken(damaged)).toBe(true);
    const restored = heal(damaged, 'head', 5);
    expect(restored.head).toBe(5);
    expect(heal(restored, 'head', 100).head).toBe(40);
    expect(applyDamage(restored, 'head', -5).head).toBe(5);
  });

  it('calculates bounded attack charge and force on the server clock', () => {
    expect(attackCharge(10, 10)).toBe(0);
    expect(attackCharge(10, 10 + ATTACK.maxChargeSeconds / 2)).toBeCloseTo(.5);
    expect(attackCharge(10, 100)).toBe(1);
    expect(attackForce('punch', .5)).toBeCloseTo(ATTACK.force.punch * .5);
    expect(attackForce('kick', 2)).toBe(ATTACK.force.kick);
  });
});
