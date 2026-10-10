import { shuffle } from '../util';
import { interactables, type Spot } from './interactables';
import type { Meeting, Person } from './types';

/** Sim minutes that pass per real second at 1x speed. */
export const CLOCK = 0.4;

/** The simulation clock and settings. `t` is minutes since midnight. */
export const sim = { t: 9 * 60 + 25, day: 1, speed: 1, paused: false, lastMinute: 0 };

/** The newest few things that happened, newest first. */
export const log: Array<{ t: number; msg: string }> = [];
/** Set when the log changed; the UI clears it after drawing. */
export const logState = { dirty: true };
export function addLog(msg: string): void {
  log.unshift({ t: sim.t, msg });
  if (log.length > 5) log.pop();
  logState.dirty = true;
}

/** Everyone in the office: people the simulation drives (isAi) and people a human drives (isDriven). Loops ask isAi, hasSlot or isDriven, whichever they mean. */
export const people: Person[] = [];
/** Meetings in progress. */
export const meetings: Meeting[] = [];
/** The desks, in the random order new staff are seated at. */
export const deskPool: Spot[] = [];
/** How many staff have been created so far (names are handed out in order). */
export const counters = { nameIdx: 0 };

/**
 * The lowest id nobody in the office is using. Ids stay small, are never shared by two people alive at once, and a person
 * keeps theirs for as long as they exist (the protocol sends them as 16 bits).
 */
export function allocatePersonId(): number {
  const used = new Set(people.map(p => p.id));
  let id = 0;
  while (used.has(id)) id++;
  return id;
}

/**
 * Put the desks in the order new staff are seated at: shuffled. (Which desk a particular person gets is decided when they are
 * created: the one they chose, else a free one; the HR office is only for the HR department.)
 * Call once after the world has registered the desks.
 */
export function initState(): void {
  deskPool.length = 0;
  deskPool.push(...shuffle([...interactables.of('desk')]));
}

/** Back to a fresh, empty simulation (tests; also a future "new world"). Spots are not touched. */
export function resetSim(): void {
  Object.assign(sim, { t: 9 * 60 + 25, day: 1, speed: 1, paused: false, lastMinute: 0 });
  log.length = 0;
  logState.dirty = true;
  people.length = 0;
  meetings.length = 0;
  deskPool.length = 0;
  counters.nameIdx = 0;
}
