/** Pure, deterministic attack and struggle rules shared by prediction and authority. */

import {
  ATTACK,
  attackCharge,
  attackForce,
  canUseHand,
  type AttackKind,
  type AttackPhase,
  type AttackSide,
  type AttackState,
  type CharacterMechanicsState,
} from './character-state';

/** Values governing the hold/struggle meter. The meter is always in [0, 1]. */
export const STRUGGLE = {
  max: 1,
  gainPerSecond: 0.35,
  decayPerSecond: 0.2,
  escapeThreshold: 1,
} as const;

const ATTACK_KINDS: readonly AttackKind[] = ['punch', 'kick', 'bash'];

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

/** The limb used to make an attack. A kick uses the corresponding leg; hand attacks use an arm. */
export function attackLimb(kind: AttackKind, side: AttackSide): 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' {
  if (kind === 'kick') return side === 'left' ? 'leftLeg' : 'rightLeg';
  return side === 'left' ? 'leftArm' : 'rightArm';
}

/** Whether this attack can begin with the selected side and the current mechanics state. */
export function canPerformAttack(state: CharacterMechanicsState, kind: AttackKind, side = state.dominantHand): boolean {
  if (state.attack !== null || state.posture === 'seated' || state.posture === 'prone') return false;
  if (state.posture === 'ragdoll' || state.posture === 'recovering' || state.health.body <= 0) return false;
  if (kind === 'kick') {
    const leg = attackLimb(kind, side);
    return state.health[leg] > 0;
  }
  return canUseHand(state, side);
}

/** Pick the requested attack when possible, otherwise the first functional attack. */
export function selectAttackKind(
  state: CharacterMechanicsState,
  requested: AttackKind,
  side = state.dominantHand,
): AttackKind | null {
  if (canPerformAttack(state, requested, side)) return requested;
  return ATTACK_KINDS.find(kind => canPerformAttack(state, kind, side)) ?? null;
}

/** Aliases retained for callers that describe the operation as choosing an attack. */
export const chooseAttackKind = selectAttackKind;
export const selectAttack = selectAttackKind;

/** Begin one charging attack. A non-finite clock is rejected; state is never mutated. */
export function beginAttack(
  state: CharacterMechanicsState,
  kind: AttackKind,
  now: number,
  side = state.dominantHand,
): CharacterMechanicsState | null {
  if (!Number.isFinite(now) || !canPerformAttack(state, kind, side)) return null;
  const previous = state.attack?.sequence ?? 0;
  const sequence = (previous + 1) & 0xffff;
  const attack: AttackState = {
    kind, side, phase: 'charging', sequence, startedAt: now, charge: 0, cooldownUntil: now,
  };
  return { ...state, attack };
}

/** Update the charge of a currently charging attack, clamped by ATTACK.maxChargeSeconds. */
export function chargeAttack(state: CharacterMechanicsState, now: number): CharacterMechanicsState {
  const attack = state.attack;
  if (!attack || attack.phase !== 'charging') return state;
  return { ...state, attack: { ...attack, charge: attackCharge(attack.startedAt, now) } };
}

/** Release a charge into the short active hit window and start its cooldown clock. */
export function releaseAttack(state: CharacterMechanicsState, now: number): CharacterMechanicsState {
  const attack = state.attack;
  if (!attack || attack.phase !== 'charging' || !Number.isFinite(now)) return state;
  const charge = attackCharge(attack.startedAt, now);
  return {
    ...state,
    attack: {
      ...attack,
      phase: 'active',
      releaseAt: now,
      charge,
      cooldownUntil: now + ATTACK.cooldownSeconds,
    },
  };
}

/** Advance an attack through its active window and cooldown, clearing it when ready. */
export function advanceAttack(state: CharacterMechanicsState, now: number): CharacterMechanicsState {
  const attack = state.attack;
  if (!attack || !Number.isFinite(now)) return state;
  if (attack.phase === 'charging') return chargeAttack(state, now);
  if (attack.phase === 'active') {
    const releaseAt = attack.releaseAt ?? now;
    if (now < releaseAt + ATTACK.hitWindowSeconds) return state;
    return { ...state, attack: { ...attack, phase: 'cooldown' } };
  }
  if (now >= attack.cooldownUntil) return { ...state, attack: null };
  return state;
}

/** Alias for tick-oriented callers. */
export const tickAttack = advanceAttack;

/** Damage dealt by a released attack at its clamped charge. */
export function attackDamage(kind: AttackKind, charge: number): number {
  return ATTACK.damage[kind] * clamp01(charge);
}

/** Force dealt by a released attack at its clamped charge. */
export function combatAttackForce(kind: AttackKind, charge: number): number {
  return attackForce(kind, clamp01(charge));
}

/** True only while an attack is in its hit window. */
export function attackIsActive(attack: AttackState | null, now: number): boolean {
  if (!attack || attack.phase !== 'active' || !Number.isFinite(now)) return false;
  return now >= (attack.releaseAt ?? Infinity) && now < (attack.releaseAt ?? Infinity) + ATTACK.hitWindowSeconds;
}

/** Add struggle effort over a duration, clamped to the meter maximum. */
export function accumulateStruggle(current: number, seconds: number, effort = 1): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(effort) || effort <= 0) return clamp01(current);
  return Math.min(STRUGGLE.max, clamp01(current) + seconds * effort * STRUGGLE.gainPerSecond);
}

/** Let the struggle meter recover over a duration. */
export function decayStruggle(current: number, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return clamp01(current);
  return Math.max(0, clamp01(current) - seconds * STRUGGLE.decayPerSecond);
}

/** Apply either effort or recovery to a struggle meter in one deterministic step. */
export function updateStruggle(current: number, seconds: number, struggling: boolean, effort = 1): number {
  return struggling ? accumulateStruggle(current, seconds, effort) : decayStruggle(current, seconds);
}

/** Whether a full struggle meter permits escape. */
export function canEscapeStruggle(value: number): boolean {
  return clamp01(value) >= STRUGGLE.escapeThreshold;
}

/** Consume an escape when possible, returning the reset meter; otherwise preserve it. */
export function escapeStruggle(value: number): number {
  return canEscapeStruggle(value) ? 0 : clamp01(value);
}
