/** Shared, serializable character-mechanics state and deterministic rules. */

export type Posture = 'standing' | 'crouching' | 'prone' | 'seated' | 'ragdoll' | 'recovering';
export type SeatMode = 'none' | 'fixed-chair' | 'free-legs-down' | 'free-crossed';
export type LocomotionMode = 'grid' | 'jump' | 'knockback' | 'ragdoll';
export type AttackKind = 'punch' | 'kick' | 'bash';
export type AttackSide = 'left' | 'right';
export type AttackPhase = 'idle' | 'charging' | 'active' | 'cooldown';
export type Limb = 'head' | 'body' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export const CROUCH = {
  min: 0,
  max: 1,
  step: .1,
  speedAtMax: .55,
  heightAtMax: .55,
  cooldown: .1,
} as const;

export const JUMP = {
  cooldown: .45,
  velocity: 4.4,
  duration: .9,
} as const;

export const ATTACK = {
  maxChargeSeconds: .9,
  cooldownSeconds: .35,
  hitWindowSeconds: .12,
  range: { punch: .95, kick: 1.15, bash: 1.05 },
  damage: { punch: 8, kick: 12, bash: 16 },
  force: { punch: 2.5, kick: 4, bash: 6 },
} as const;

export const LIMB_MAX_HP: Readonly<Record<Limb, number>> = {
  head: 40, body: 80, leftArm: 35, rightArm: 35, leftLeg: 45, rightLeg: 45,
};

export type LimbHealth = Record<Limb, number>;

export interface AttackState {
  kind: AttackKind;
  side: AttackSide;
  phase: Exclude<AttackPhase, 'idle'>;
  sequence: number;
  startedAt: number;
  releaseAt?: number;
  charge: number;
  cooldownUntil: number;
}

export interface CharacterMechanicsState {
  posture: Posture;
  crouchLevel: number;
  seatMode: SeatMode;
  seatId: string | null;
  locomotion: LocomotionMode;
  grounded: boolean;
  verticalVelocity: number;
  jumpUntil: number;
  jumpHeld: boolean;
  proneHeld: boolean;
  knockbackUntil: number;
  attack: AttackState | null;
  dominantHand: AttackSide;
  struggle: number;
  health: LimbHealth;
  holdTarget: string | null;
  heldBy: string | null;
  /** Relative attachment angle (radians) for the direct hold, or zero when absent. */
  holdAz?: number;
  /** Relative attachment height (metres) for the direct hold, or one when absent. */
  holdLift?: number;
  inventoryRevision: number;
}

export function fullHealth(): LimbHealth { return { ...LIMB_MAX_HP }; }

export function defaultCharacterMechanics(): CharacterMechanicsState {
  return {
    posture: 'standing', crouchLevel: 0, seatMode: 'none', seatId: null,
    locomotion: 'grid', grounded: true, verticalVelocity: 0, jumpUntil: 0, jumpHeld: false, proneHeld: false, knockbackUntil: 0,
    attack: null, dominantHand: 'right', struggle: 0, health: fullHealth(),
    holdTarget: null, heldBy: null, holdAz: 0, holdLift: 1, inventoryRevision: 0,
  };
}

export function clampCrouchLevel(level: number): number {
  return Number.isFinite(level) ? Math.max(CROUCH.min, Math.min(CROUCH.max, level)) : 0;
}

export function adjustCrouch(level: number, wheelSteps: number): number {
  if (!Number.isFinite(wheelSteps)) return clampCrouchLevel(level);
  return clampCrouchLevel(level + Math.max(-20, Math.min(20, Math.trunc(wheelSteps))) * CROUCH.step);
}

export function postureSpeedFactor(posture: Posture, crouchLevel: number): number {
  if (posture === 'prone') return .25;
  if (posture === 'crouching') return 1 - (1 - CROUCH.speedAtMax) * clampCrouchLevel(crouchLevel);
  if (posture === 'seated' || posture === 'ragdoll' || posture === 'recovering') return 0;
  return 1;
}

export function canMove(s: CharacterMechanicsState): boolean {
  return (s.posture === 'standing' || s.posture === 'crouching' || s.posture === 'prone')
    && !legsBroken(s.health) && !bodyBroken(s.health)
    && s.locomotion !== 'ragdoll' && s.locomotion !== 'knockback';
}

export function canUseHands(s: CharacterMechanicsState): boolean {
  return s.posture !== 'ragdoll' && s.posture !== 'recovering' && s.health.body > 0
    && (s.health.leftArm > 0 || s.health.rightArm > 0);
}

export function canUseHand(s: CharacterMechanicsState, side: AttackSide): boolean {
  return s.posture !== 'ragdoll' && s.posture !== 'recovering' && s.health.body > 0
    && s.health[side === 'left' ? 'leftArm' : 'rightArm'] > 0;
}

export function legsBroken(health: LimbHealth): boolean { return health.leftLeg <= 0 || health.rightLeg <= 0; }
export function headBroken(health: LimbHealth): boolean { return health.head <= 0; }
export function bodyBroken(health: LimbHealth): boolean { return health.body <= 0; }

export function applyDamage(health: LimbHealth, limb: Limb, amount: number): LimbHealth {
  const next = { ...health };
  if (Number.isFinite(amount) && amount > 0) next[limb] = Math.max(0, next[limb] - amount);
  return next;
}

export function heal(health: LimbHealth, limb: Limb, amount: number): LimbHealth {
  const next = { ...health };
  if (Number.isFinite(amount) && amount > 0) next[limb] = Math.min(LIMB_MAX_HP[limb], next[limb] + amount);
  return next;
}

export function attackCharge(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.min(1, (now - startedAt) / ATTACK.maxChargeSeconds));
}

export function attackForce(kind: AttackKind, charge: number): number {
  return ATTACK.force[kind] * Math.max(0, Math.min(1, charge));
}
