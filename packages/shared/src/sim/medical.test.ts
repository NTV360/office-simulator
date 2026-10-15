import { describe, expect, it } from 'vitest';
import { defaultCharacterMechanics, fullHealth, LIMB_MAX_HP } from './character-state';
import { isLimb, medicalHealSeconds, medicalHealing, mostHurtLimb, useMedicalItem } from './medical';

describe('medical limb healing', () => {
  it('recognises the six limbs and catalogue-independent medical items', () => {
    expect(Object.keys(LIMB_MAX_HP)).toHaveLength(6);
    expect(isLimb('head')).toBe(true);
    expect(isLimb('leftLeg')).toBe(true);
    expect(isLimb('arm')).toBe(false);
    expect(medicalHealing('bandage')).toBe(15);
    expect(medicalHealing('first-aid-box')).toBe(30);
    expect(medicalHealing('mug')).toBeNull();
  });

  it('heals only the selected limb, clamps at its maximum, and preserves input', () => {
    const state = defaultCharacterMechanics();
    state.health.leftArm = 5;
    const result = useMedicalItem(state, 'bandage', 'leftArm');
    expect(result).toEqual({ ok: true, health: { ...state.health, leftArm: 20 }, amount: 15 });
    expect(state.health.leftArm).toBe(5);
    expect(useMedicalItem({ ...state, health: { ...state.health, leftArm: 30 } }, 'first-aid-box', 'leftArm')).toMatchObject({ ok: true, amount: 5 });
  });

  it('gates healing when hands are unavailable and rejects invalid uses', () => {
    const state = defaultCharacterMechanics();
    state.health.body = 0;
    expect(useMedicalItem(state, 'bandage', 'head')).toEqual({ ok: false, reason: 'hands-disabled' });
    expect(useMedicalItem(defaultCharacterMechanics(), 'mug', 'head')).toEqual({ ok: false, reason: 'not-medical' });
    expect(useMedicalItem(defaultCharacterMechanics(), 'bandage', 'arm')).toEqual({ ok: false, reason: 'invalid-limb' });
    expect(useMedicalItem(defaultCharacterMechanics(), 'bandage', 'toString')).toEqual({ ok: false, reason: 'invalid-limb' });
    expect(useMedicalItem(defaultCharacterMechanics(), 'bandage', '__proto__')).toEqual({ ok: false, reason: 'invalid-limb' });
    expect(useMedicalItem(defaultCharacterMechanics(), 'bandage', 'head')).toEqual({ ok: false, reason: 'already-full' });
  });
});

describe('timed care', () => {
  it('a bandage takes 3 seconds and a first-aid box 5', () => {
    expect(medicalHealSeconds('bandage')).toBe(3);
    expect(medicalHealSeconds('first-aid-box')).toBe(5);
    expect(medicalHealSeconds('mug')).toBeNull();
  });

  it('picks the limb that is missing the most health, and nothing when all are full', () => {
    const full = fullHealth();
    expect(mostHurtLimb(full)).toBeNull();
    expect(mostHurtLimb({ ...full, leftArm: 30, body: 50, rightLeg: 40 })).toBe('body');
    expect(mostHurtLimb({ ...full, head: 0, leftLeg: 0 })).toBe('leftLeg'); // (45 missing beats 40)
    expect(mostHurtLimb({ ...full, leftArm: 20, rightArm: 20 })).toBe('leftArm'); // (equal: the first one)
  });
});
