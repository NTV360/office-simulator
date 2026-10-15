import type { CharacterMechanicsState } from './character-state';

/** Tunables shared by melee, thrown-object, and other physical impacts. */
export const IMPACT = {
  minSpeed: 1.5,
  staggerImpulse: 2.5,
  ragdollImpulse: 7,
  maxImpulse: 12,
  maxDisplacement: .6,
  knockbackSeconds: .22,
  recoverySeconds: .65,
} as const;

export interface ImpactVector {
  x: number;
  z: number;
}

export interface ImpactInput {
  /** Direction from the impacting thing towards the character. */
  normal: ImpactVector;
  /** Relative speed at contact, in metres per second. */
  relativeSpeed: number;
  /** Mass of the impacting thing, in kilograms. */
  mass: number;
  /** An already-authoritative impulse, such as a charged attack. */
  force?: number;
}

export interface ResolvedImpact {
  normal: ImpactVector;
  impulse: number;
  displacement: ImpactVector;
  ragdoll: boolean;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/** Resolve a contact into a bounded horizontal impulse. Resting/slow contacts are intentionally ignored. */
export function resolveImpact(input: ImpactInput): ResolvedImpact | null {
  const nx = finite(input.normal.x), nz = finite(input.normal.z);
  const length = Math.hypot(nx, nz);
  if (length < 1e-6) return null;
  const speed = Math.max(0, finite(input.relativeSpeed));
  const mass = Math.max(0, finite(input.mass));
  const force = Math.max(0, finite(input.force ?? 0));
  if (speed < IMPACT.minSpeed && force <= 0) return null;
  const impulse = clamp(mass * speed + force, 0, IMPACT.maxImpulse);
  if (impulse <= 0) return null;
  const normal = { x: nx / length, z: nz / length };
  const distance = clamp(impulse / 20, 0, IMPACT.maxDisplacement);
  return {
    normal,
    impulse,
    displacement: { x: normal.x * distance, z: normal.z * distance },
    ragdoll: impulse >= IMPACT.ragdollImpulse,
  };
}

/** Apply the state portion of an impact; movement itself remains collision-safe in the server movement layer. */
export function applyImpact(state: CharacterMechanicsState, impact: ResolvedImpact, now: number): CharacterMechanicsState {
  const at = finite(now);
  if (impact.ragdoll) {
    return {
      ...state,
      posture: 'ragdoll',
      seatId: null,
      seatMode: 'none',
      locomotion: 'ragdoll',
      grounded: false,
      attack: null,
      knockbackUntil: at + IMPACT.recoverySeconds,
    };
  }
  return {
    ...state,
    posture: state.posture === 'seated' ? 'standing' : state.posture,
    seatId: state.posture === 'seated' ? null : state.seatId,
    seatMode: state.posture === 'seated' ? 'none' : state.seatMode,
    locomotion: 'knockback',
    grounded: true,
    attack: null,
    knockbackUntil: at + IMPACT.knockbackSeconds,
  };
}

/** Advance knockback/ragdoll into a short, controllable recovery state. */
export function advanceImpact(state: CharacterMechanicsState, now: number): CharacterMechanicsState {
  if (!Number.isFinite(now) || state.knockbackUntil <= 0 || now < state.knockbackUntil) return state;
  if (state.locomotion === 'ragdoll' || state.posture === 'ragdoll') {
    return { ...state, posture: 'recovering', locomotion: 'grid', grounded: true, knockbackUntil: now + IMPACT.recoverySeconds };
  }
  if (state.posture === 'recovering') return { ...state, posture: 'standing', locomotion: 'grid', grounded: true, knockbackUntil: 0 };
  return { ...state, locomotion: 'grid', knockbackUntil: 0 };
}
