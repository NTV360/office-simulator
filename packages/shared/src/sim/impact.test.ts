import { describe, expect, it } from 'vitest';
import { defaultCharacterMechanics } from './character-state';
import { IMPACT, advanceImpact, applyImpact, resolveImpact } from './impact';

describe('physical impacts', () => {
  it('ignores resting contact and normalizes direction', () => {
    expect(resolveImpact({ normal: { x: 0, z: 1 }, relativeSpeed: 1, mass: 20 })).toBeNull();
    const hit = resolveImpact({ normal: { x: 3, z: 4 }, relativeSpeed: 2, mass: 1 });
    expect(hit?.normal).toEqual({ x: .6, z: .8 });
    expect(hit?.impulse).toBe(2);
  });

  it('clamps mass-derived impulse and displacement', () => {
    const hit = resolveImpact({ normal: { x: 1, z: 0 }, relativeSpeed: 100, mass: 100 });
    expect(hit?.impulse).toBe(IMPACT.maxImpulse);
    expect(hit?.displacement.x).toBe(IMPACT.maxDisplacement);
  });

  it('uses an authoritative force and marks heavy hits as ragdolls', () => {
    const hit = resolveImpact({ normal: { x: 0, z: -1 }, relativeSpeed: 0, mass: 0, force: IMPACT.ragdollImpulse });
    expect(hit?.ragdoll).toBe(true);
    const state = applyImpact(defaultCharacterMechanics(), hit!, 10);
    expect(state.posture).toBe('ragdoll');
    expect(state.locomotion).toBe('ragdoll');
  });

  it('clears stale seating metadata when a heavy impact ragdolls a character', () => {
    const seated = { ...defaultCharacterMechanics(), posture: 'seated' as const, seatId: 'desk:12', seatMode: 'fixed-chair' as const };
    const hit = resolveImpact({ normal: { x: 1, z: 0 }, relativeSpeed: 0, mass: 0, force: IMPACT.ragdollImpulse })!;
    const ragdoll = applyImpact(seated, hit, 10);
    expect(ragdoll).toMatchObject({ posture: 'ragdoll', locomotion: 'ragdoll', seatId: null, seatMode: 'none' });
  });

  it('recovers ragdolls in two server-observed phases', () => {
    const hit = resolveImpact({ normal: { x: 1, z: 0 }, relativeSpeed: 0, mass: 0, force: IMPACT.ragdollImpulse })!;
    const ragdoll = applyImpact(defaultCharacterMechanics(), hit, 10);
    const recovering = advanceImpact(ragdoll, 10 + IMPACT.recoverySeconds);
    expect(recovering.posture).toBe('recovering');
    const standing = advanceImpact(recovering, recovering.knockbackUntil);
    expect(standing.posture).toBe('standing');
    expect(standing.knockbackUntil).toBe(0);
  });
});
