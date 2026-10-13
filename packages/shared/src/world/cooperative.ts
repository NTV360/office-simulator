import type { Point } from './arms';

/** Tunables for the soft link between people carrying one object together. */
export const COOPERATIVE = {
  /** The hand may lag this far before the normal hold leash is allowed to break. */
  leash: .6,
  /** A correction never moves a person more than this in one physics tick. */
  followStep: .09,
  /** Start gently following when the hand has fallen this far behind its grip. */
  followFrom: .3,
  /** A helper walking against the object's travel direction is opposed after this long. */
  opposeAfter: .35,
  /** Ignore tiny/resting velocities when deciding whether movement is opposed. */
  opposeSpeed: .12,
  /** Dot-product threshold for entering opposition against the object's horizontal travel. */
  opposeDot: -.35,
  /** Relaxed dot-product threshold while an opposition episode is already active. */
  opposeExitDot: -.15,
  /** Opposition must be clear for this long before its grace timer is reset. */
  opposeClear: .12,
} as const;

export function horizontal(point: Point): { x: number; z: number } {
  return { x: point.x, z: point.z };
}

export function dotHorizontal(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z;
}

function motionDot(
  handVelocity: { x: number; z: number },
  objectVelocity: { x: number; z: number },
): number | null {
  const hv = Math.hypot(handVelocity.x, handVelocity.z);
  const ov = Math.hypot(objectVelocity.x, objectVelocity.z);
  if (hv < COOPERATIVE.opposeSpeed || ov < COOPERATIVE.opposeSpeed) return null;
  return dotHorizontal(handVelocity, objectVelocity) / (hv * ov);
}

/** True when movement is sufficiently against travel to start an opposition episode. */
export function opposedMotion(
  handVelocity: { x: number; z: number },
  objectVelocity: { x: number; z: number },
): boolean {
  return (motionDot(handVelocity, objectVelocity) ?? 1) <= COOPERATIVE.opposeDot;
}

/** True while an existing opposition episode remains meaningfully opposed. */
export function oppositionContinues(
  handVelocity: { x: number; z: number },
  objectVelocity: { x: number; z: number },
): boolean {
  return (motionDot(handVelocity, objectVelocity) ?? 1) <= COOPERATIVE.opposeExitDot;
}

export function followDisplacement(
  hand: Point,
  grip: Point,
  maxStep = COOPERATIVE.followStep,
): { x: number; z: number } {
  const dx = grip.x - hand.x, dz = grip.z - hand.z, d = Math.hypot(dx, dz);
  if (d <= COOPERATIVE.followFrom || d < 1e-9) return { x: 0, z: 0 };
  const amount = Math.min(maxStep, d - COOPERATIVE.followFrom);
  return { x: dx / d * amount, z: dz / d * amount };
}
