import { randomSpec } from '../character/spec';
import { clampSlotCount } from '../server-defaults';
import { TAU, pick, random, rnd } from '../util';
import { FIRST, LAST, SCREEN_VARIANTS, roleBag, type ScreenKind } from './data';
import { simEvents } from './events';
import { HAZEL_LEAVE_AT, HAZEL_NAME, applyHazel } from './hazel';
import { hasSlot, isAi } from './person';
import { newProps } from './props';
import { interactables } from './interactables';
import { allocatePersonId, counters, deskPool, people, sim } from './state';
import { endTask } from './tasks';
import type { Person } from './types';

/** Create the next staff member at a free desk. Returns null when no desk is free. The new person is away until their arrival time. */
export function makeStaff(): Person | null {
  const slot = deskPool.find(s => !s.owner); if (!slot) return null;
  let role = pick(roleBag);
  const spec = randomSpec(role);
  const nameIdx = counters.nameIdx;
  let first = FIRST[nameIdx % FIRST.length], last = LAST[(nameIdx * 7 + 3) % LAST.length] + '.';
  if (nameIdx === 0) ({ first, last, role } = applyHazel(spec));
  counters.nameIdx++;
  const screenKind: ScreenKind = role.includes('Designer') ? 'design' : role === 'DevOps' ? 'dash' : 'code';
  // the order of the random draws below is part of the recorded simulation; do not reorder
  const p: Person = {
    id: allocatePersonId(), controller: 'ai', name: `${first} ${last}`, role, spec, slot,
    pos: slot.pos.clone(), face: slot.face, faceGoal: slot.face, speed: rnd(1.15, 1.45),
    state: 'away', shown: false, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: random() * TAU, animT: random() * 10,
    pose: {}, arriveAt: 0, leaveAt: 0, lunchAt: 0, hadLunch: false, arrivedAt: null, coffees: 0, chatWith: null, meeting: null,
    screenKind, screenVariant: 0,
  };
  p.screenVariant = Math.floor(random() * SCREEN_VARIANTS[screenKind]); // same single draw as picking from the list
  slot.owner = p;
  scheduleDay(p);
  people.push(p);
  simEvents.emit('personAdded', p);
  return p;
}

/**
 * Remove the most recently added unclaimed staff member. A person who belongs to an account, and anyone a human is
 * driving, is never removed. Their desk is free again.
 */
export function removeStaff(): Person | null {
  const removable = (p: Person) => isAi(p) && hasSlot(p) && p.owner === undefined;
  let i = people.length - 1; while (i >= 0 && !removable(people[i])) i--;
  if (i < 0) return null;
  const [p] = people.splice(i, 1);
  endTask(p); if (p.slot) p.slot.owner = null;
  simEvents.emit('personRemoved', p);
  return p;
}

/**
 * Change how many slots there are: add people at free desks or remove the most recent unclaimed ones, never beyond the number
 * of desks and never below the number that belong to accounts.
 * Someone added during the working day arrives within a few minutes instead of waiting for their scheduled time.
 * Returns the new number of staff.
 */
export function setStaffCount(requested: number): number {
  const target = clampSlotCount(requested, interactables.of('desk').length);
  const count = () => people.filter(hasSlot).length;
  while (count() < target) {
    const p = makeStaff();
    if (!p) break;
    if (sim.t < p.leaveAt - 30 && sim.t > 7 * 60 + 50) p.arriveAt = sim.t + rnd(.1, 4);
  }
  while (count() > target) { if (!removeStaff()) break; } // claimed people stay, so the number can stop above the target
  return count();
}

/** A fresh NPC name (the next in the list), for a person an account has given up. Uses no random numbers. */
export function npcName(): string {
  const i = counters.nameIdx++;
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}.`;
}

/** Pick today's arrival, lunch and leaving times. */
export function scheduleDay(p: Person): void {
  p.arriveAt = rnd(7 * 60 + 50, 9 * 60 + 35); p.leaveAt = rnd(17 * 60 + 10, 18 * 60 + 50);
  p.lunchAt = rnd(11 * 60 + 45, 12 * 60 + 40); p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = HAZEL_LEAVE_AT; // Hazel is always the last one out
}
