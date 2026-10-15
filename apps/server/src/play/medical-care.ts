import {
  CARE_REACH, CARE_WALK_LIMIT, MEDKIT_REACH, canUseHands, createInventory, findFirstFit, hasLineOfSight, isSeated, medicalHealSeconds, medkitContents, mostHurtLimb, objects, placeItem, takeFromMedkit,
  useMedicalItem, type MedicalItem, type MedkitContents, type MedkitItem, type Person, type InventoryState, type LimbHealth,
} from '@office/shared';

// The server's rules for the medkit box on the kitchen counter and for timed care (hold E on the hotbar item). Pure checks: they say what may
// happen and what the result is; the player manager applies it (and owns the clock). What is in a box and how it fills again: shared/sim/medkit-state.ts.

/** The sight line to a medkit stops this far short of it: it stands on a counter, and the floor next to a counter is not walkable for some way out. */
const MEDKIT_STAND_OFF = .9;

export type MedkitRefusal = 'not-medkit' | 'too-far' | 'busy' | 'empty' | 'no-room' | 'stale';
export const MEDKIT_REFUSAL_TEXT: Readonly<Record<MedkitRefusal, string>> = {
  'not-medkit': 'That is not a medkit.',
  'too-far': 'Step closer to the medkit.',
  busy: 'Stand up first.',
  empty: 'The medkit has none left.',
  'no-room': 'There is no room in your inventory.',
  stale: 'Your inventory just changed; try again.',
};

export type MedkitOpen = { ok: true; object: number; contents: MedkitContents } | { ok: false; reason: MedkitRefusal };
export type MedkitTake = { ok: true; object: number; contents: MedkitContents; inventory: InventoryState } | { ok: false; reason: MedkitRefusal };

/** The medkit this person may use right now, or why not. A medkit stands on a counter, which is not floor, so the sight line stops short of it. */
function usableMedkit(person: Person, index: number): { ok: true; index: number } | { ok: false; reason: MedkitRefusal } {
  const o = Number.isInteger(index) ? objects.at(index) : undefined;
  if (!o || o.removed || o.type !== 'medkit-box') return { ok: false, reason: 'not-medkit' };
  if (isSeated(person)) return { ok: false, reason: 'busy' };
  const dx = o.x - person.pos.x, dz = o.z - person.pos.z, d = Math.hypot(dx, dz);
  if (!Number.isFinite(d) || d > MEDKIT_REACH) return { ok: false, reason: 'too-far' };
  const k = d > 1e-9 ? Math.max(0, d - MEDKIT_STAND_OFF) / d : 0;
  if (!hasLineOfSight(person.pos, { x: person.pos.x + dx * k, z: person.pos.z + dz * k })) return { ok: false, reason: 'too-far' };
  return { ok: true, index: o.index };
}

export function openMedkit(person: Person, index: number): MedkitOpen {
  const m = usableMedkit(person, index);
  return m.ok ? { ok: true, object: m.index, contents: medkitContents(m.index) } : m;
}

/** Take one item out of the box into the inventory (the first place it fits). Nothing changes unless it all works; the caller keeps `inventory`. */
export function takeFromMedkitInto(person: Person, index: number, item: MedkitItem): MedkitTake {
  const m = usableMedkit(person, index);
  if (!m.ok) return m;
  if (medkitContents(m.index)[item] <= 0) return { ok: false, reason: 'empty' };
  const have = new Set(person.inventory.items.map(i => i.id));
  let n = 1;
  while (have.has(`medkit:${item}:${n}`)) n++; // (a name nothing in this inventory has: a restored inventory may hold earlier ones)
  const id = `medkit:${item}:${n}`;
  const fit = findFirstFit(person.inventory ?? createInventory(), id, item, 0);
  if (!fit) return { ok: false, reason: 'no-room' };
  takeFromMedkit(m.index, item);
  return { ok: true, object: m.index, contents: medkitContents(m.index), inventory: placeItem(person.inventory, fit) };
}

// ---- timed care

export type CareRefusal = 'not-medical' | 'hands' | 'target' | 'too-far' | 'down' | 'unhurt';
export type CareCancel = 'gone' | 'hurt' | 'hit' | 'moved' | 'range';
export interface CareJob {
  itemId: string;
  item: MedicalItem;
  targetId: number;
  startedAt: number;
  seconds: number;
  from: { x: number; z: number };
  /** Total health of the medic and the patient when it began: either getting lower means somebody was hit. */
  health: { medic: number; target: number };
}

const totalHealth = (h: LimbHealth): number => h.head + h.body + h.leftArm + h.rightArm + h.leftLeg + h.rightLeg;
/** On the ground or being thrown about: cannot give or take care. */
const down = (p: Person): boolean => {
  const m = p.mechanics;
  return m.posture === 'ragdoll' || m.posture === 'recovering' || m.locomotion === 'ragdoll' || m.locomotion === 'knockback';
};
const medicalItemOf = (p: Person, itemId: string): MedicalItem | null => {
  const item = p.inventory.items.find(i => i.id === itemId);
  return item && medicalHealSeconds(item.type) !== null ? item.type as MedicalItem : null;
};

/** May this medic start caring for this patient (the patient may be the medic) with this inventory item? */
export function startCare(medic: Person, itemId: string, target: Person, now: number): { ok: true; job: CareJob } | { ok: false; reason: CareRefusal } {
  const item = medicalItemOf(medic, itemId);
  if (!item) return { ok: false, reason: 'not-medical' };
  if (!canUseHands(medic.mechanics) || down(medic)) return { ok: false, reason: 'hands' };
  if (target.controller !== 'account') return { ok: false, reason: 'target' };
  if (down(target)) return { ok: false, reason: 'down' };
  if (target !== medic) {
    if (target.mechanics.health.body <= 0) return { ok: false, reason: 'target' };
    if (!inCareRange(medic, target)) return { ok: false, reason: 'too-far' };
  }
  if (mostHurtLimb(target.mechanics.health) === null) return { ok: false, reason: 'unhurt' };
  return {
    ok: true,
    job: {
      itemId, item, targetId: target.id, startedAt: now, seconds: medicalHealSeconds(item)!, from: { x: medic.pos.x, z: medic.pos.z },
      health: { medic: totalHealth(medic.mechanics.health), target: totalHealth(target.mechanics.health) },
    },
  };
}

function inCareRange(medic: Person, target: Person): boolean {
  const d = Math.hypot(target.pos.x - medic.pos.x, target.pos.z - medic.pos.z);
  return Number.isFinite(d) && d <= CARE_REACH && hasLineOfSight(medic.pos, target.pos);
}

/** Where the care is now: still going, finished, or ended and why. `target` is undefined if that person has left. */
export function advanceCare(job: CareJob, medic: Person, target: Person | undefined, now: number): 'running' | 'done' | CareCancel {
  if (!target || !medicalItemOf(medic, job.itemId)) return 'gone';
  if (!canUseHands(medic.mechanics) || down(medic) || down(target)) return 'hurt';
  if (totalHealth(medic.mechanics.health) < job.health.medic || totalHealth(target.mechanics.health) < job.health.target) return 'hit';
  if (Math.hypot(medic.pos.x - job.from.x, medic.pos.z - job.from.z) > CARE_WALK_LIMIT) return 'moved';
  if (target !== medic) {
    if (target.mechanics.health.body <= 0) return 'hurt';
    if (!inCareRange(medic, target)) return 'range';
  }
  return now - job.startedAt >= job.seconds ? 'done' : 'running';
}

/** The care is done: what the patient's health becomes, or null if there is nothing left to heal (then nothing is used up). */
export function finishCare(job: CareJob, medic: Person, target: Person): LimbHealth | null {
  const limb = mostHurtLimb(target.mechanics.health);
  if (limb === null) return null;
  const healed = useMedicalItem(target.mechanics, job.item, limb, { requireHands: target === medic });
  return healed.ok ? healed.health : null;
}
