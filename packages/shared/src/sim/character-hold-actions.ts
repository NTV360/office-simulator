import { OX, OY, S } from '../plan';
import { walkPx } from '../nav/grid';
import { REACH } from '../world/placement';
import { canUseHands } from './character-state';
import { people } from './state';
import type { Person } from './types';
import { CharacterHoldGraph, type CharacterHold } from './character-holds';

/** Refusals for authoritative character-to-character holding. */
export type CharacterHoldRefusal = 'not-found' | 'too-far' | 'busy' | 'blocked';
export type CharacterHoldResult = { ok: true; edge?: CharacterHold } | { ok: false; reason: CharacterHoldRefusal };

/** The one authoritative relationship graph for the currently loaded world. */
export const characterHolds = new CharacterHoldGraph();

const personOf = (id: number): Person | undefined => people.find(p => p.id === id);
const clearMechanics = (edge: CharacterHold): void => {
  const holder = personOf(edge.holder), target = personOf(edge.target);
  if (holder?.mechanics.holdTarget === String(edge.target)) {
    holder.mechanics.holdTarget = null; holder.mechanics.holdAz = 0; holder.mechanics.holdLift = 1;
  }
  if (target?.mechanics.heldBy === String(edge.holder)) target.mechanics.heldBy = null;
};

/** Apply authoritative attachment poses after all independent movement for this tick. */
export function syncCharacterHoldTransforms(): void {
  for (const root of people) {
    if (characterHolds.getHolder(root.id)) continue;
    // (each one in the chain hangs from the one before it, whose own place is always on the floor)
    let anchor = { x: root.pos.x, z: root.pos.z };
    for (const transform of Array.from(characterHolds.transforms({ id: root.id, x: root.pos.x, z: root.pos.z, face: root.face }))) {
      const target = personOf(transform.id);
      if (!target) continue;
      // A hold never carries anybody through a wall or off the floor: when the place in front of the holder is not floor (they have
      // backed against something), the held person stays with the holder instead, and goes out in front again when there is room.
      const room = walkPx(transform.x / S + OX, transform.z / S + OY);
      const x = room ? transform.x : anchor.x, z = room ? transform.z : anchor.z;
      target.pos.x = x; target.pos.z = z; target.face = target.faceGoal = transform.face;
      target.path = null; target.pi = 0; target.walkPhase = 0;
      anchor = { x, z };
    }
  }
}

/** Attach one character to another after checking server-side reach and graph invariants. */
export function grabCharacter(holder: Person, targetId: number, az = 0, lift = 1): CharacterHoldResult {
  const target = personOf(targetId);
  if (!target || target === holder) return { ok: false, reason: 'not-found' };
  // Only people take hold of people: the office's own workers follow their own tasks and would be dragged about by the hold.
  if (holder.controller !== 'account' || target.controller !== 'account') return { ok: false, reason: 'blocked' };
  // Sitting owns seat/task occupancy; do not attach a seated person and leave that
  // state behind when the hold moves them away from the seat.
  if (holder.mechanics.posture === 'seated' || target.mechanics.posture === 'seated'
    || holder.task?.kind === 'playerSit' || target.task?.kind === 'playerSit') return { ok: false, reason: 'blocked' };
  if (!canUseHands(holder.mechanics) || !canUseHands(target.mechanics)) return { ok: false, reason: 'blocked' };
  if (Math.hypot(holder.pos.x - target.pos.x, holder.pos.z - target.pos.z) > REACH) return { ok: false, reason: 'too-far' };
  if (!Number.isFinite(az) || !Number.isFinite(lift) || Math.abs(az) > Math.PI || lift < 0 || lift > 3) return { ok: false, reason: 'blocked' };
  if (characterHolds.getHeld(holder.id) || characterHolds.getHolder(target.id)) return { ok: false, reason: 'busy' };
  const edge: CharacterHold = { holder: holder.id, target: target.id, az, lift };
  if (!characterHolds.attach(edge)) return { ok: false, reason: 'blocked' };
  holder.mechanics.holdTarget = String(target.id);
  holder.mechanics.holdAz = az;
  holder.mechanics.holdLift = lift;
  target.mechanics.heldBy = String(holder.id);
  target.path = null; target.pi = 0;
  target.mechanics.locomotion = 'grid'; target.mechanics.grounded = true; target.mechanics.verticalVelocity = 0;
  return { ok: true, edge };
}

/** Release the character currently held by `holder`, if any. */
export function releaseCharacter(holder: Person): CharacterHoldResult {
  const edge = characterHolds.detach(holder.id);
  if (!edge) return { ok: false, reason: 'busy' };
  clearMechanics(edge);
  return { ok: true, edge };
}

/** A held character may break free once its authoritative struggle meter is full. */
export function escapeCharacter(target: Person): CharacterHoldResult {
  const edge = characterHolds.detachTarget(target.id);
  if (!edge) return { ok: false, reason: 'busy' };
  clearMechanics(edge);
  target.mechanics.struggle = 0;
  return { ok: true, edge };
}

/** Throw is deliberately non-combat: it only ends the authoritative hold. */
export function throwCharacter(holder: Person): CharacterHoldResult {
  return releaseCharacter(holder);
}

/** Keep graph and per-person snapshot state in sync when a person leaves or is reset. */
export function releaseCharacterPerson(personId: number): CharacterHold[] {
  const edges = characterHolds.releasePerson(personId);
  for (const edge of edges) clearMechanics(edge);
  return edges;
}

export function resetCharacterHolds(): void {
  for (const edge of characterHolds.all()) clearMechanics(edge);
  characterHolds.clear();
}
