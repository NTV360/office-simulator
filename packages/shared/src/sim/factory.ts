import { randomSpec } from '../character/spec';
import { clampSlotCount } from '../server-defaults';
import { TAU, pick, random, rnd } from '../util';
import { FIRST, LAST, SCREEN_VARIANTS, roleBag, type ScreenKind } from './data';
import { simEvents } from './events';
import { HAZEL_LEAVE_AT, HAZEL_NAME, applyHazel } from './hazel';
import { isStaff } from './person';
import { newProps } from './props';
import { interactables } from './interactables';
import { counters, deskPool, people, sim } from './state';
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
    id: people.filter(isStaff).length, controller: 'ai', name: `${first} ${last}`, role, spec, slot,
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

/** Remove the most recently added staff member (a human-controlled person is left alone). Their desk is free again. */
export function removeStaff(): Person | null {
  let i = people.length - 1; while (i >= 0 && !isStaff(people[i])) i--;
  if (i < 0) return null;
  const [p] = people.splice(i, 1);
  endTask(p); if (p.slot) p.slot.owner = null;
  simEvents.emit('personRemoved', p);
  return p;
}

/**
 * Change how many staff there are: add people at free desks or remove the most recent, never beyond the number of desks.
 * Someone added during the working day arrives within a few minutes instead of waiting for their scheduled time.
 * Returns the new number of staff.
 */
export function setStaffCount(requested: number): number {
  const target = clampSlotCount(requested, interactables.of('desk').length);
  const count = () => people.filter(isStaff).length;
  while (count() < target) {
    const p = makeStaff();
    if (!p) break;
    if (sim.t < p.leaveAt - 30 && sim.t > 7 * 60 + 50) p.arriveAt = sim.t + rnd(.1, 4);
  }
  while (count() > target) removeStaff();
  return count();
}

/** Pick today's arrival, lunch and leaving times. */
export function scheduleDay(p: Person): void {
  p.arriveAt = rnd(7 * 60 + 50, 9 * 60 + 35); p.leaveAt = rnd(17 * 60 + 10, 18 * 60 + 50);
  p.lunchAt = rnd(11 * 60 + 45, 12 * 60 + 40); p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = HAZEL_LEAVE_AT; // Hazel is always the last one out
}
