/**
 * Who drives a person. 'ai' people are driven by the simulation (autopilot, whether or not a desk is claimed).
 * 'account' people are driven by a human: the simulation never steps them or picks them for meetings.
 */
export type Controller = 'ai' | 'account';

/** The simulation drives this person: it steps them, picks them for meetings, and sends them home at night. */
export const isAi = (p: { controller: Controller }): boolean => p.controller === 'ai';
/** A human drives this person. (Not the same as "is the player on this page": see isLocalPlayer in the client.) */
export const isDriven = (p: { controller: Controller }): boolean => p.controller === 'account';
/**
 * This person has a desk (a slot): they count in the ledger, in the staff number an admin sets, and in the saved world.
 * A guest (a human with no desk yet) has none.
 */
export const hasSlot = (p: { slot?: unknown }): boolean => p.slot != null;
