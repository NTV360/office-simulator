import { describe, expect, it } from 'vitest';
import { ATTACK, defaultCharacterMechanics } from './character-state';
import {
  accumulateStruggle, advanceAttack, attackDamage, attackIsActive, attackLimb, beginAttack,
  canEscapeStruggle, canPerformAttack, chargeAttack, combatAttackForce, decayStruggle,
  escapeStruggle, releaseAttack, selectAttackKind, updateStruggle,
} from './combat';

describe('shared combat rules', () => {
  it('selects punch, kick, or bash and gates attacks by functional limbs', () => {
    const state = defaultCharacterMechanics();
    expect(selectAttackKind(state, 'punch', 'right')).toBe('punch');
    expect(attackLimb('kick', 'left')).toBe('leftLeg');
    state.health.rightArm = 0;
    expect(canPerformAttack(state, 'punch', 'right')).toBe(false);
    expect(selectAttackKind(state, 'punch', 'right')).toBe('kick');
    state.health.leftLeg = 0;
    state.health.rightLeg = 0;
    state.health.rightArm = 1;
    expect(selectAttackKind(state, 'kick', 'left')).toBe('punch');
    expect(selectAttackKind(state, 'bash', 'right')).toBe('bash');
    state.health.leftArm = 0;
    state.health.rightArm = 0;
    expect(selectAttackKind(state, 'bash', 'right')).toBeNull();
  });

  it('allows only one active attack and advances charging, active, and cooldown phases', () => {
    const state = defaultCharacterMechanics();
    const charging = beginAttack(state, 'punch', 10, 'left');
    expect(charging?.attack).toMatchObject({ kind: 'punch', side: 'left', phase: 'charging', charge: 0 });
    expect(beginAttack(charging!, 'kick', 10.1, 'right')).toBeNull();
    const charged = chargeAttack(charging!, 10 + ATTACK.maxChargeSeconds * 2);
    expect(charged.attack?.charge).toBe(1);
    const active = releaseAttack(charged, 11);
    expect(active.attack).toMatchObject({ phase: 'active', releaseAt: 11, charge: 1 });
    expect(attackIsActive(active.attack, 11)).toBe(true);
    const cooldown = advanceAttack(active, 11 + ATTACK.hitWindowSeconds);
    expect(cooldown.attack?.phase).toBe('cooldown');
    expect(advanceAttack(cooldown, cooldown.attack!.cooldownUntil).attack).toBeNull();
  });

  it('clamps damage and force from charge', () => {
    expect(attackDamage('punch', -.2)).toBe(0);
    expect(attackDamage('kick', 2)).toBe(ATTACK.damage.kick);
    expect(combatAttackForce('bash', .5)).toBeCloseTo(ATTACK.force.bash * .5);
  });

  it('accumulates, decays, and consumes struggle escape', () => {
    expect(accumulateStruggle(0, 1)).toBeCloseTo(.35);
    expect(accumulateStruggle(.9, 10)).toBe(1);
    expect(decayStruggle(1, 1)).toBeCloseTo(.8);
    expect(updateStruggle(0, 1, true, 2)).toBeCloseTo(.7);
    expect(canEscapeStruggle(1)).toBe(true);
    expect(escapeStruggle(1)).toBe(0);
    expect(escapeStruggle(.99)).toBeCloseTo(.99);
  });
});
