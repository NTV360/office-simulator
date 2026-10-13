/** Pure validation for sitting on an arbitrary support surface.
 *
 * This deliberately does not know about registered `Spot`s.  A chair can keep
 * using the driven seating path, while a future desk/table/ledge interaction
 * can validate a free sit with the same server-authoritative rules.
 */

export type FreeSitMode = 'free-legs-down' | 'free-crossed';

export interface SittingPoint {
  x: number;
  z: number;
}

/** A horizontal, rectangular area that can support a free-sitting person. */
export interface FreeSitSupport {
  center: SittingPoint;
  /** Half extents in the support's local frame. `width`/`depth` are accepted as a convenience. */
  halfWidth?: number;
  halfDepth?: number;
  width?: number;
  depth?: number;
  topY: number;
  rotation?: number;
  /** Defaults to true so existing geometry can opt in without another flag. */
  supportsSitting?: boolean;
  occupant?: unknown | null;
}

export interface FreeSitValidation {
  support: FreeSitSupport;
  position: SittingPoint;
  heading: number;
  /** Minimum distance from the body centre to every support edge. */
  edgeClearance?: number;
  /** Space needed in front of the seated body for legs-down posture. */
  legsDownClearance?: number;
  /** Space needed for crossed legs; normally less than legs-down clearance. */
  crossedLegsClearance?: number;
  /** Identity of the person asking; an occupant may revalidate their own seat. */
  person?: unknown;
  /** A point is clear if a body can occupy it (and, for stand points, leave it). */
  isClear?: (point: SittingPoint) => boolean;
  /** Candidate points are tried in order; the first clear point is authoritative. */
  standUpCandidates: readonly SittingPoint[];
}

export type FreeSitFailure =
  | 'invalid-support'
  | 'unsupported-surface'
  | 'occupied'
  | 'outside-support'
  | 'edge-clearance'
  | 'legs-blocked'
  | 'no-safe-stand';

export type FreeSitClassification =
  | { ok: true; mode: FreeSitMode; standUp: SittingPoint }
  | { ok: false; reason: FreeSitFailure };

export const FREE_SIT_DEFAULTS = {
  edgeClearance: 0.2,
  legsDownClearance: 0.65,
  crossedLegsClearance: 0.3,
} as const;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const pointFinite = (p: SittingPoint): boolean => finite(p.x) && finite(p.z);

function halfExtent(value: number | undefined, full: number | undefined): number | null {
  const n = value ?? (full === undefined ? NaN : full / 2);
  return finite(n) && n > 0 ? n : null;
}

function local(point: SittingPoint, center: SittingPoint, rotation: number): SittingPoint {
  const dx = point.x - center.x, dz = point.z - center.z;
  return { x: dx * Math.cos(rotation) - dz * Math.sin(rotation), z: dx * Math.sin(rotation) + dz * Math.cos(rotation) };
}

/**
 * Validate a free sit without mutating a person, support, or registry.
 *
 * The caller supplies the walk/collision predicate and stand-up candidates so
 * the same function can run on the server and in prediction. Legs-down is
 * preferred; crossed legs is a valid fallback when only the longer leg sweep
 * is blocked. Occupancy is checked before geometry and is identity-aware.
 */
export function classifyFreeSitting(input: FreeSitValidation): FreeSitClassification {
  const s = input.support;
  const hw = halfExtent(s.halfWidth, s.width), hd = halfExtent(s.halfDepth, s.depth);
  if (!pointFinite(s.center) || !pointFinite(input.position) || !finite(s.topY) || hw === null || hd === null) return { ok: false, reason: 'invalid-support' };
  if (s.supportsSitting === false) return { ok: false, reason: 'unsupported-surface' };
  if (s.occupant != null && s.occupant !== input.person) return { ok: false, reason: 'occupied' };
  if (!finite(input.heading)) return { ok: false, reason: 'outside-support' };

  const rotation = finite(s.rotation) ? s.rotation : 0;
  const p = local(input.position, s.center, rotation);
  const edge = input.edgeClearance ?? FREE_SIT_DEFAULTS.edgeClearance;
  if (!finite(edge) || edge < 0 || Math.abs(p.x) > hw - edge || Math.abs(p.z) > hd - edge) return { ok: false, reason: 'edge-clearance' };

  const clear = input.isClear ?? (() => true);
  const bodyClear = clear(input.position);
  const legsDown = input.legsDownClearance ?? FREE_SIT_DEFAULTS.legsDownClearance;
  const crossed = input.crossedLegsClearance ?? FREE_SIT_DEFAULTS.crossedLegsClearance;
  if (!finite(legsDown) || !finite(crossed) || legsDown < 0 || crossed < 0) return { ok: false, reason: 'legs-blocked' };

  // +z in the person's local frame is the direction their legs extend.
  const front = { x: input.position.x - Math.sin(input.heading) * legsDown, z: input.position.z + Math.cos(input.heading) * legsDown };
  const crossedFront = { x: input.position.x - Math.sin(input.heading) * crossed, z: input.position.z + Math.cos(input.heading) * crossed };
  const clearSweep = (to: SittingPoint): boolean => {
    const distance = Math.hypot(to.x - input.position.x, to.z - input.position.z);
    const steps = Math.max(1, Math.ceil(distance / .1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!clear({ x: input.position.x + (to.x - input.position.x) * t, z: input.position.z + (to.z - input.position.z) * t })) return false;
    }
    return true;
  };
  const legsDownOK = clearSweep(front);
  const crossedOK = !legsDownOK && clearSweep(crossedFront);
  if (!legsDownOK && !crossedOK) return { ok: false, reason: 'legs-blocked' };
  if (!bodyClear) return { ok: false, reason: 'outside-support' };

  const standUp = input.standUpCandidates.find(point => pointFinite(point) && clear(point));
  if (!standUp) return { ok: false, reason: 'no-safe-stand' };
  return { ok: true, mode: legsDownOK ? 'free-legs-down' : 'free-crossed', standUp: { x: standUp.x, z: standUp.z } };
}

/** Alias emphasizing that this is a validation/classification operation. */
export const validateFreeSitting = classifyFreeSitting;
