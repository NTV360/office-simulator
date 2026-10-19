/** Which body part a punch, kick or bash lands on, from where the attacker is looking. Pure and deterministic: the server uses it, tests pin it. */

import { CROUCH, type AttackKind, type Limb, type Posture } from './character-state';

/** The geometry, in metres. A person is about 1.45 m to the top of the head, with the eyes at about 1.3 m (character/rig.js). */
export const AIM = {
  eyeStanding: 1.3,
  eyeDropCrouch: .28, // at full crouch (the client lowers the camera by this much)
  eyeDropProne: .95,
  heightStanding: 1.45,
  heightProne: .35,
  /** Shares of a person's height: below `legsBelow` the legs, above `headAbove` the head, between them the body and arms. */
  legsBelow: .47,
  headAbove: .84,
  /** Across the body: within this of the middle is the body, further out (up to the arm) is that side's arm. */
  bodyHalfWidth: .16,
  /** A look beyond this up or down is not believed (a broken client): it is level. */
  maxPitch: 1.5,
} as const;

export interface AimInput {
  kind: AttackKind;
  /** The attacker's posture and, if crouching, how far (0 to 1). */
  attackerPosture: Posture;
  attackerCrouch: number;
  /** Where the attacker looks: up is positive, in radians. Missing or not a number means level. */
  pitch?: number;
  /** The attacker's facing (the way they look sideways), the target's facing and posture. */
  attackerFace: number;
  targetFace: number;
  targetPosture: Posture;
  targetCrouch: number;
  /** From the attacker to the target's middle, along the ground (x and z). */
  dx: number;
  dz: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const lying = (p: Posture): boolean => p === 'prone' || p === 'ragdoll' || p === 'recovering';

/** A look angle the server will believe: finite and within +-maxPitch, else level. */
export function sanePitch(pitch: unknown): number {
  return typeof pitch === 'number' && Number.isFinite(pitch) ? Math.max(-AIM.maxPitch, Math.min(AIM.maxPitch, pitch)) : 0;
}

/** How high the attacker's eyes are. */
export function eyeHeightOf(posture: Posture, crouch: number): number {
  if (lying(posture)) return AIM.eyeStanding - AIM.eyeDropProne;
  return AIM.eyeStanding - (posture === 'crouching' ? AIM.eyeDropCrouch * clamp01(crouch) : 0);
}

/** How tall the target is right now (a crouching person is shorter; one on the ground is a low target). */
export function heightOf(posture: Posture, crouch: number): number {
  if (lying(posture)) return AIM.heightProne;
  if (posture === 'crouching') return AIM.heightStanding * (1 - (1 - CROUCH.heightAtMax) * clamp01(crouch));
  return AIM.heightStanding;
}

/**
 * The part this attack lands on. Where the line of sight crosses the target decides it: high is the head, low is the legs, in between the
 * body, and a line to one side of the middle of the body is that side's arm (or, low down, that side's leg). A person on the ground is just a
 * body. A kick cannot reach the head, so a high kick lands on the body.
 */
export function aimedLimb(input: AimInput): Limb {
  if (lying(input.targetPosture)) return 'body';
  const distance = Math.hypot(input.dx, input.dz);
  const y = eyeHeightOf(input.attackerPosture, input.attackerCrouch) + Math.tan(sanePitch(input.pitch)) * distance;
  const share = y / heightOf(input.targetPosture, input.targetCrouch);
  // how far to the target's right the line passes from the middle of them (the target's own right, whichever way they face)
  const rightX = Math.cos(input.attackerFace), rightZ = -Math.sin(input.attackerFace); // the attacker's right
  const lateral = input.dx * rightX + input.dz * rightZ; // the target's middle is this far to the attacker's right: the line is this far to its left
  const targetRightX = Math.cos(input.targetFace), targetRightZ = -Math.sin(input.targetFace);
  const side = -lateral * (rightX * targetRightX + rightZ * targetRightZ) >= 0 ? 'right' : 'left';
  const across = Math.abs(lateral * (rightX * targetRightX + rightZ * targetRightZ));
  if (share < AIM.legsBelow) return side === 'right' ? 'rightLeg' : 'leftLeg';
  if (share > AIM.headAbove) return input.kind === 'kick' ? 'body' : 'head';
  if (across > AIM.bodyHalfWidth) return side === 'right' ? 'rightArm' : 'leftArm';
  return 'body';
}
