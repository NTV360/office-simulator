import {
  canUseHands,
  heal,
  LIMB_MAX_HP,
  type CharacterMechanicsState,
  type Limb,
  type LimbHealth,
} from './character-state';

/** Medical items are deliberately pure rules until the catalogue has client prefabs for them. */
export type MedicalItem = 'bandage' | 'first-aid-box';

/** Health restored to the selected limb by one use. */
export const MEDICAL_HEALING: Readonly<Record<MedicalItem, number>> = {
  bandage: 15,
  'first-aid-box': 30,
};

export type MedicalUseResult =
  | { ok: true; health: LimbHealth; amount: number }
  | { ok: false; reason: 'not-medical' | 'hands-disabled' | 'invalid-limb' | 'already-full' };

/** Return the healing amount for an item, or null when it is not a medical item. */
export function medicalHealing(item: string): number | null {
  return item === 'bandage' || item === 'first-aid-box' ? MEDICAL_HEALING[item] : null;
}

/** Whether a limb name is one of the six authoritative health slots. */
export function isLimb(value: string): value is Limb {
  return Object.prototype.hasOwnProperty.call(LIMB_MAX_HP, value);
}

/** Apply one medical item without mutating the source state. Authority can consume the item after ok=true. */
export function useMedicalItem(
  state: CharacterMechanicsState,
  item: string,
  limb: string,
  options: { requireHands?: boolean } = {},
): MedicalUseResult {
  const amount = medicalHealing(item);
  if (amount === null) return { ok: false, reason: 'not-medical' };
  // Self-treatment requires usable hands. A remote treatment call validates the
  // medic separately and must not require the patient's arms to work.
  if (options.requireHands !== false && !canUseHands(state)) return { ok: false, reason: 'hands-disabled' };
  if (!isLimb(limb)) return { ok: false, reason: 'invalid-limb' };
  if (state.health[limb] >= LIMB_MAX_HP[limb]) return { ok: false, reason: 'already-full' };
  const health = heal(state.health, limb, amount);
  return { ok: true, health, amount: health[limb] - state.health[limb] };
}

/** How long, in seconds, the medic must keep applying each item before it heals (the item is used up only when it does). */
export const MEDICAL_HEAL_SECONDS: Readonly<Record<MedicalItem, number>> = {
  bandage: 3,
  'first-aid-box': 5,
};

/** Seconds of care an item needs, or null when it is not a medical item. */
export function medicalHealSeconds(item: string): number | null {
  return item === 'bandage' || item === 'first-aid-box' ? MEDICAL_HEAL_SECONDS[item] : null;
}

/** The limb that is missing the most health (the first of those, head to legs, when several are equal); null when nothing is hurt. */
export function mostHurtLimb(health: LimbHealth): Limb | null {
  let worst: Limb | null = null, most = 0;
  for (const limb of Object.keys(LIMB_MAX_HP) as Limb[]) {
    const missing = LIMB_MAX_HP[limb] - health[limb];
    if (missing > most) { most = missing; worst = limb; }
  }
  return worst;
}
